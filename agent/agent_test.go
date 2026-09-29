package main

import (
	"context"
	"encoding/json"
	"image"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type scriptedPlatform struct {
	mu   sync.Mutex
	w    Window
	idle float64
}

func (p *scriptedPlatform) Foreground() (Window, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.w, nil
}
func (p *scriptedPlatform) IdleSeconds() (float64, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.idle, nil
}
func (p *scriptedPlatform) Screenshot() (image.Image, error) {
	return image.NewRGBA(image.Rect(0, 0, 2000, 1000)), nil
}
func (p *scriptedPlatform) Close() {}

type fakeServer struct {
	mu          sync.Mutex
	events      []Event
	agents      []AgentInfo
	shots       int
	shotType    string
	down        bool
	revoked     bool
	screenshots bool
	allowPause  bool
	sawPaused   bool
	sawResumed  bool
}

func (s *fakeServer) snapshotEvents() []Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Event(nil), s.events...)
}

func (s *fakeServer) flags() (paused, resumed bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sawPaused, s.sawResumed
}

func (s *fakeServer) lastInfo() AgentInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.agents) == 0 {
		return AgentInfo{}
	}
	return s.agents[len(s.agents)-1]
}

func newFakeHTTP(t *testing.T, s *fakeServer) string {
	ts := httptest.NewServer(s.handler(t))
	t.Cleanup(ts.Close)
	return ts.URL
}

func (s *fakeServer) handler(t *testing.T) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		if r.Header.Get("Authorization") != "Device tok" || s.revoked {
			w.WriteHeader(401)
			io.WriteString(w, `{"error":"Invalid or revoked device token"}`)
			return
		}
		if s.down {
			w.WriteHeader(503)
			return
		}
		switch r.URL.Path {
		case "/api/agent/config":
			json.NewEncoder(w).Encode(map[string]any{"device_id": 7, "heartbeat_seconds": 60, "screenshots_enabled": s.screenshots, "screenshot_interval_mins": 1, "idle_threshold_seconds": 60, "away_after_minutes": 30, "allow_pause": s.allowPause})
		case "/api/agent/heartbeat":
			var body struct {
				Events []Event   `json:"events"`
				Agent  AgentInfo `json:"agent"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("bad heartbeat body: %v", err)
			}
			s.events = append(s.events, body.Events...)
			s.agents = append(s.agents, body.Agent)
			if body.Agent.PausedUntil != "" {
				s.sawPaused = true
			}
			if body.Agent.Resumed {
				s.sawResumed = true
			}
			w.WriteHeader(202)
			io.WriteString(w, `{"accepted":1}`)
		case "/api/agent/screenshot":
			f, h, err := r.FormFile("file")
			if err != nil {
				t.Errorf("screenshot: %v", err)
				w.WriteHeader(400)
				return
			}
			f.Close()
			s.shots++
			s.shotType = h.Header.Get("Content-Type")
			w.WriteHeader(201)
			io.WriteString(w, `{"id":1}`)
		default:
			w.WriteHeader(404)
		}
	})
}

func newTestAgent(t *testing.T, url string, p Platform) (*Agent, *time.Time) {
	t.Setenv("PEOPLEHUB_AGENT_HOME", t.TempDir())
	a := NewAgent(Config{Server: url, Token: "tok"}, p, log.New(io.Discard, "", 0))
	clock := at("10:00:00")
	a.now = func() time.Time { clockMu.Lock(); defer clockMu.Unlock(); return clock }
	return a, &clock
}

// clockMu guards the fake clock, which background goroutines (status pings) also read.
var clockMu sync.Mutex

// step advances the fake clock one sample at a time (the real loop does this on a 5 s ticker).
func step(a *Agent, clock *time.Time, d time.Duration) error {
	var err error
	clockMu.Lock()
	end := clock.Add(d)
	clockMu.Unlock()
	for a.now().Before(end) {
		clockMu.Lock()
		*clock = clock.Add(sampleEvery)
		clockMu.Unlock()
		a.tick(context.Background())
		if e := a.sendDue(context.Background()); e != nil {
			err = e
		}
	}
	return err
}

func TestAgentUploadsAndSurvivesOutages(t *testing.T) {
	srv := &fakeServer{}
	ts := httptest.NewServer(srv.handler(t))
	defer ts.Close()
	p := &scriptedPlatform{w: Window{App: "Google Chrome", Title: "Docs", URL: "https://docs.google.com/x"}}
	a, clock := newTestAgent(t, ts.URL, p)
	if err := a.refreshConfig(context.Background()); err != nil {
		t.Fatal(err)
	}
	step(a, clock, 3*time.Minute)
	srv.mu.Lock()
	n := len(srv.events)
	srv.mu.Unlock()
	if n == 0 {
		t.Fatal("no events uploaded")
	}
	if e := srv.events[0]; e.Domain != "docs.google.com" || e.App != "Google Chrome" || e.Active < 55 {
		t.Fatalf("unexpected event %+v", e)
	}
	if srv.agents[0].Version == "" || srv.agents[0].OS == "" {
		t.Fatalf("agent info missing: %+v", srv.agents[0])
	}

	// Server goes down: events queue up on disk, then flush when it recovers.
	srv.mu.Lock()
	srv.down = true
	srv.mu.Unlock()
	step(a, clock, 5*time.Minute)
	if a.queue.Len() < 4 {
		t.Fatalf("events should be queued while offline, queued=%d", a.queue.Len())
	}
	srv.mu.Lock()
	srv.down = false
	srv.mu.Unlock()
	step(a, clock, 6*time.Minute) // backoff is at most a few minutes here
	if a.queue.Len() > 1 {        // the newest minute may still be waiting for the next heartbeat
		t.Fatalf("queue should drain after recovery, queued=%d", a.queue.Len())
	}
	srv.mu.Lock()
	defer srv.mu.Unlock()
	minutes := map[string]bool{}
	for _, e := range srv.events {
		minutes[e.TS] = true
	}
	if len(minutes) < 12 {
		t.Fatalf("expected ~13 distinct minutes after the outage, got %d", len(minutes))
	}
}

func TestAgentIdleAwayAndScreenshots(t *testing.T) {
	srv := &fakeServer{screenshots: true}
	ts := httptest.NewServer(srv.handler(t))
	defer ts.Close()
	p := &scriptedPlatform{w: Window{App: "Code"}}
	a, clock := newTestAgent(t, ts.URL, p)
	a.refreshConfig(context.Background())
	a.nextShot = *clock
	step(a, clock, 2*time.Minute)
	p.mu.Lock()
	p.idle = 120 // idle, but not away
	p.mu.Unlock()
	step(a, clock, 2*time.Minute)
	p.mu.Lock()
	p.idle = 31 * 60 // away: nothing more is recorded
	p.mu.Unlock()
	step(a, clock, 3*time.Minute)
	srv.mu.Lock()
	defer srv.mu.Unlock()
	active, idle := sum(srv.events)
	if active < 110 || idle < 100 {
		t.Fatalf("want ~2 min active and ~2 min idle, got %ds/%ds", active, idle)
	}
	if active+idle > 4*60+10 {
		t.Fatalf("away time must not be recorded: %ds total", active+idle)
	}
	if srv.shots == 0 || srv.shotType != "image/jpeg" {
		t.Fatalf("expected JPEG screenshots while active, got %d (%s)", srv.shots, srv.shotType)
	}
}

func TestAgentStopsWhenTokenRevoked(t *testing.T) {
	srv := &fakeServer{}
	ts := httptest.NewServer(srv.handler(t))
	defer ts.Close()
	a, clock := newTestAgent(t, ts.URL, &scriptedPlatform{w: Window{App: "Code"}})
	a.refreshConfig(context.Background())
	srv.mu.Lock()
	srv.revoked = true
	srv.mu.Unlock()
	if err := step(a, clock, 2*time.Minute); err != errUnauthorized {
		t.Fatalf("want errUnauthorized, got %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := a.Run(ctx); err != errUnauthorized {
		t.Fatalf("Run should stop on a revoked token, got %v", err)
	}
	st, _ := loadState()
	if !strings.Contains(st.Stopped, "token") {
		t.Fatalf("state should record why it stopped: %+v", st)
	}
}

func TestEncodeScreenshotDownscales(t *testing.T) {
	data, err := encodeScreenshot(image.NewRGBA(image.Rect(0, 0, 3840, 2160)), 1600, 70)
	if err != nil {
		t.Fatal(err)
	}
	cfg, format, err := image.DecodeConfig(strings.NewReader(string(data)))
	if err != nil || format != "jpeg" || cfg.Width != 1600 || cfg.Height != 900 {
		t.Fatalf("got %s %dx%d %v", format, cfg.Width, cfg.Height, err)
	}
}

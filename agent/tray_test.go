package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"image/png"
	"strings"
	"testing"
	"time"
)

func labels(m []menuEntry) string {
	var s []string
	for _, e := range m {
		if e.Separator {
			s = append(s, "---")
		} else {
			s = append(s, e.Label)
		}
	}
	return strings.Join(s, " | ")
}

func TestTrayMenu(t *testing.T) {
	now := at("10:00:00")
	base := TrayState{Status: "tracking", Connected: true, LastUpload: now.Add(-2 * time.Minute), Screenshots: true, ScreenshotMins: 10, AllowPause: true, Server: "https://hr.example.com", EmployeeID: 4, Version: "1.2.3"}

	m := labels(trayMenu(base, now))
	for _, want := range []string{"PeopleHub · Tracking activity", "Last upload: 2 min ago", "Screenshots: on (about every 10 min)", "Pause for 15 minutes", "Pause for 1 hour", "View my activity", "Open PeopleHub", "Agent version 1.2.3"} {
		if !strings.Contains(m, want) {
			t.Errorf("menu missing %q: %s", want, m)
		}
	}

	noPause := base
	noPause.AllowPause = false
	if strings.Contains(labels(trayMenu(noPause, now)), "Pause") {
		t.Error("pause must be hidden when the organisation doesn't allow it")
	}

	paused := base
	paused.Status, paused.PausedUntil = "paused", now.Add(15*time.Minute)
	pm := labels(trayMenu(paused, now))
	if !strings.Contains(pm, "Resume tracking") || strings.Contains(pm, "Pause for") || !strings.Contains(pm, "Paused until") {
		t.Errorf("paused menu wrong: %s", pm)
	}

	off := base
	off.Connected, off.Queued = false, 42
	if !strings.Contains(labels(trayMenu(off, now)), "Offline — 42 events waiting to upload") {
		t.Errorf("offline line missing: %s", labels(trayMenu(off, now)))
	}
	if !strings.Contains(trayTooltip(off, now), "(offline)") {
		t.Error("tooltip should say offline")
	}

	stopped := base
	stopped.Status = "stopped"
	if strings.Contains(labels(trayMenu(stopped, now)), "Pause") {
		t.Error("a stopped agent can't be paused")
	}
}

type fakeBackend struct {
	s       TrayState
	paused  time.Duration
	resumed bool
}

func (f *fakeBackend) TrayState() TrayState  { return f.s }
func (f *fakeBackend) Pause(d time.Duration) { f.paused = d }
func (f *fakeBackend) Resume()               { f.resumed = true }

func TestHandleMenu(t *testing.T) {
	b := &fakeBackend{s: TrayState{Server: "https://hr.example.com", EmployeeID: 7}}
	var opened []string
	open := func(u string) { opened = append(opened, u) }
	handleMenu(b, menuPause60, open)
	handleMenu(b, menuResume, open)
	handleMenu(b, menuMyActivity, open)
	handleMenu(b, menuOpenPeopleHub, open)
	if b.paused != time.Hour || !b.resumed {
		t.Fatalf("pause/resume not forwarded: %+v", b)
	}
	if strings.Join(opened, ",") != "https://hr.example.com/productivity/7,https://hr.example.com" {
		t.Fatalf("opened %v", opened)
	}
}

func TestIconKey(t *testing.T) {
	cases := map[string]TrayState{
		"active":  {Status: "tracking", Connected: true},
		"idle":    {Status: "paused", Connected: true},
		"away":    {Status: "away", Connected: true},
		"offline": {Status: "tracking", Connected: false},
		"error":   {Status: "stopped", Connected: true},
	}
	for want, s := range cases {
		if got := iconKey(s); got != want {
			t.Errorf("iconKey(%+v) = %s, want %s", s, got, want)
		}
	}
}

func TestTrayIconAndPNG(t *testing.T) {
	img := trayIcon(32, "active")
	if img.Bounds().Dx() != 32 {
		t.Fatal("wrong size")
	}
	if img.RGBAAt(0, 0).A != 0 {
		t.Error("corners should be transparent")
	}
	if c := img.RGBAAt(24, 24); c.G < 120 || c.A < 200 {
		t.Errorf("status dot should be green, got %+v", c)
	}
	data, err := pngWithDPI(img, 144)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := png.Decode(bytes.NewReader(data)); err != nil {
		t.Fatalf("PNG with pHYs must still decode: %v", err)
	}
	i := bytes.Index(data, []byte("pHYs"))
	if i < 0 || binary.BigEndian.Uint32(data[i+4:]) != 5669 {
		t.Fatalf("pHYs chunk missing or wrong (144 dpi = 5669 px/m)")
	}
}

func TestAgentPauseAndResume(t *testing.T) {
	srv := &fakeServer{allowPause: true}
	ts := newFakeHTTP(t, srv)
	p := &scriptedPlatform{w: Window{App: "Code"}}
	a, clock := newTestAgent(t, ts, p)
	a.refreshConfig(context.Background())
	step(a, clock, 2*time.Minute)
	a.Pause(15 * time.Minute)
	if st := a.TrayState(); st.Status != "paused" || !st.AllowPause {
		t.Fatalf("state after pause: %+v", st)
	}
	before := len(srv.snapshotEvents())
	step(a, clock, 5*time.Minute)
	for _, e := range srv.snapshotEvents()[before:] {
		if ts, _ := time.Parse(time.RFC3339, e.TS); ts.After(at("10:02:30")) {
			t.Fatalf("activity recorded while paused: %+v", e)
		}
	}
	waitFor(t, func() bool { p, _ := srv.flags(); return p })
	// Every heartbeat sent while paused (the status ping and the upload of the last partial minute alike)
	// carries the pause, so an upload can never clear it on the server.
	if last := srv.lastInfo(); last.PausedUntil == "" {
		t.Fatalf("latest heartbeat during the pause omitted paused_until: %+v", last)
	}
	a.Resume()
	waitFor(t, func() bool { _, r := srv.flags(); return r })
	step(a, clock, 2*time.Minute)
	if st := a.TrayState(); st.Status != "tracking" {
		t.Fatalf("should track again after resume, got %s", st.Status)
	}

	// Not allowed by the organisation: Pause is ignored.
	srv2 := &fakeServer{}
	a2, _ := newTestAgent(t, newFakeHTTP(t, srv2), &scriptedPlatform{w: Window{App: "Code"}})
	a2.refreshConfig(context.Background())
	a2.Pause(time.Hour)
	if a2.TrayState().Status == "paused" {
		t.Fatal("pause must be ignored when not allowed")
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	for i := 0; i < 100; i++ {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("condition not met")
}

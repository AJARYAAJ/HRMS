package main

import (
	"context"
	"errors"
	"log"
	"math/rand"
	"os"
	"runtime"
	"time"
)

const (
	sampleEvery = 5 * time.Second
	batchSize   = 200
	maxQueued   = 50000
)

// Agent samples the foreground app every few seconds, rolls samples into per-minute events,
// queues them on disk and uploads them. Screenshots are taken only when the organisation enables them.
type Agent struct {
	cfg      Config
	client   *Client
	platform Platform
	queue    *Queue
	tracker  *Tracker
	info     AgentInfo
	logger   *log.Logger
	now      func() time.Time

	remote    RemoteConfig
	state     State
	backoff   time.Duration
	nextSend  time.Time
	nextShot  time.Time
	idleSince time.Time
	away      bool
}

func NewAgent(cfg Config, p Platform, logger *log.Logger) *Agent {
	host, _ := os.Hostname()
	return &Agent{
		cfg: cfg, client: NewClient(cfg.Server, cfg.Token), platform: p, logger: logger,
		queue: OpenQueue(pathIn("queue.jsonl"), maxQueued), tracker: NewTracker(3 * sampleEvery),
		info: AgentInfo{Version: version, OS: runtime.GOOS + "/" + runtime.GOARCH, Hostname: host},
		now:  time.Now, remote: RemoteConfig{}.withDefaults(),
	}
}

// Run blocks until ctx is cancelled or the server revokes the token.
func (a *Agent) Run(ctx context.Context) error {
	a.state = State{PID: os.Getpid(), StartedAt: a.now(), Queued: a.queue.Len()}
	saveState(a.state)
	if err := a.refreshConfig(ctx); errors.Is(err, errUnauthorized) {
		return a.stop(err)
	} else if err != nil {
		a.logger.Printf("could not load settings from %s (will keep tracking and retry): %v", a.cfg.Server, err)
	}
	a.nextShot = a.now().Add(a.jitter(time.Duration(a.remote.ScreenshotIntervalMin) * time.Minute))
	sample := time.NewTicker(sampleEvery)
	defer sample.Stop()
	refresh := time.NewTicker(10 * time.Minute)
	defer refresh.Stop()
	a.logger.Printf("tracking started (server %s, heartbeat every %ds, screenshots %v)", a.cfg.Server, a.remote.HeartbeatSeconds, a.remote.ScreenshotsEnabled)
	for {
		select {
		case <-ctx.Done():
			a.shutdown()
			return nil
		case <-refresh.C:
			if err := a.refreshConfig(ctx); errors.Is(err, errUnauthorized) {
				return a.stop(err)
			}
		case <-sample.C:
			a.tick(ctx)
			if errors.Is(a.sendDue(ctx), errUnauthorized) {
				return a.stop(errUnauthorized)
			}
		}
	}
}

func (a *Agent) refreshConfig(ctx context.Context) error {
	c, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	rc, err := a.client.Config(c)
	if err == nil {
		a.remote = rc
	}
	return err
}

// tick takes one sample and queues any completed minutes.
func (a *Agent) tick(ctx context.Context) {
	now := a.now()
	s, ok := a.observe(now)
	var events []Event
	if ok {
		events = a.tracker.Observe(now, s)
	} else {
		events = a.tracker.Flush(now) // away: stop counting, but keep what was recorded
	}
	if err := a.queue.Push(events...); err != nil {
		a.logger.Printf("could not write the offline queue: %v", err)
	}
	if ok && !s.Idle && a.remote.ScreenshotsEnabled && !now.Before(a.nextShot) {
		a.nextShot = now.Add(a.jitter(time.Duration(a.remote.ScreenshotIntervalMin) * time.Minute))
		a.screenshot(ctx)
	}
}

// observe returns the current sample; ok=false means the user has been away long enough to stop recording.
func (a *Agent) observe(now time.Time) (Sample, bool) {
	idle, err := a.platform.IdleSeconds()
	if err != nil {
		idle = 0
	}
	if idle >= float64(a.remote.IdleThresholdSeconds) {
		if idle >= float64(a.remote.AwayAfterMinutes*60) {
			if !a.away {
				a.logger.Printf("no input for %d minutes: pausing until activity resumes", a.remote.AwayAfterMinutes)
			}
			a.away = true
			return Sample{}, false
		}
		return Sample{Idle: true}, true
	}
	if a.away {
		a.logger.Printf("activity resumed")
		a.away = false
	}
	w, err := a.platform.Foreground()
	if err != nil {
		return Sample{App: "Unknown"}, true
	}
	s := Sample{App: w.App, Title: truncate(w.Title, 300)}
	if w.URL != "" {
		s.Domain = domainOf(w.URL)
	}
	return s, true
}

// sendDue uploads queued events when the heartbeat interval (or a retry backoff) has elapsed.
func (a *Agent) sendDue(ctx context.Context) error {
	now := a.now()
	if now.Before(a.nextSend) || a.queue.Len() == 0 {
		return nil
	}
	for a.queue.Len() > 0 {
		batch := a.queue.Peek(batchSize)
		c, cancel := context.WithTimeout(ctx, 30*time.Second)
		err := a.client.Heartbeat(c, batch, a.info)
		cancel()
		var rejected *rejectedError
		switch {
		case err == nil:
			_ = a.queue.Drop(len(batch))
			a.backoff = 0
			a.state.LastHeartbeatAt, a.state.LastError = a.now(), ""
		case errors.As(err, &rejected):
			// A bad batch would block the queue forever; drop it and carry on.
			a.logger.Printf("dropping %d events the server rejected: %v", len(batch), err)
			_ = a.queue.Drop(len(batch))
			a.state.LastError = err.Error()
		default:
			a.backoff = min(max(a.backoff*2, 15*time.Second), 5*time.Minute)
			a.nextSend = now.Add(a.backoff)
			a.state.LastError, a.state.Queued = err.Error(), a.queue.Len()
			saveState(a.state)
			if !errors.Is(err, errUnauthorized) {
				a.logger.Printf("upload failed, retrying in %s (%d events queued): %v", a.backoff, a.queue.Len(), err)
			}
			return err
		}
	}
	a.nextSend = now.Add(time.Duration(a.remote.HeartbeatSeconds) * time.Second)
	a.state.Queued = 0
	saveState(a.state)
	return nil
}

func (a *Agent) screenshot(ctx context.Context) {
	img, err := a.platform.Screenshot()
	if err != nil {
		a.logger.Printf("screenshot failed: %v", err)
		return
	}
	data, err := encodeScreenshot(img, 1600, 70)
	if err != nil {
		a.logger.Printf("screenshot encoding failed: %v", err)
		return
	}
	c, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	if err := a.client.Screenshot(c, data); err != nil {
		if errors.Is(err, errForbidden) {
			a.remote.ScreenshotsEnabled = false // turned off by HR since the last config refresh
		}
		a.logger.Printf("screenshot upload failed: %v", err)
		return
	}
	a.state.LastScreenshot = a.now()
	saveState(a.state)
}

func (a *Agent) shutdown() {
	_ = a.queue.Push(a.tracker.Flush(a.now())...)
	a.nextSend = time.Time{}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = a.sendDue(ctx)
	a.state.Stopped = "stopped"
	saveState(a.state)
	a.logger.Printf("tracking stopped (%d events queued for next start)", a.queue.Len())
}

func (a *Agent) stop(err error) error {
	a.state.Stopped, a.state.LastError = "token rejected", err.Error()
	saveState(a.state)
	a.logger.Printf("stopping: %v. Register the device again in PeopleHub → Productivity → Devices and re-run setup.", err)
	return err
}

// jitter spreads screenshots ±20% so they can't be predicted.
func (a *Agent) jitter(d time.Duration) time.Duration {
	return d + time.Duration((rand.Float64()*0.4-0.2)*float64(d))
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

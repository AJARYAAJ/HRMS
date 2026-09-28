package main

import "testing"

func TestParseHelpers(t *testing.T) {
	idle, err := parseHIDIdle(`    |   "HIDIdleTime" = 4570185541`)
	if err != nil || idle < 4.5 || idle > 4.6 {
		t.Fatalf("parseHIDIdle = %v, %v", idle, err)
	}
	if got := parseLsappinfoName(`"LSDisplayName"="Google Chrome"`); got != "Google Chrome" {
		t.Fatalf("parseLsappinfoName = %q", got)
	}
}

// Runs on a real Mac (GitHub Actions macos-latest).
func TestDarwinPlatform(t *testing.T) {
	p, err := newPlatform()
	if err != nil {
		t.Fatal(err)
	}
	idle, err := p.IdleSeconds()
	if err != nil {
		t.Fatalf("IdleSeconds: %v", err)
	}
	t.Logf("idle: %.1fs", idle)
	w, err := p.Foreground()
	t.Logf("foreground: %+v err=%v", w, err)
	img, err := p.Screenshot()
	t.Logf("screenshot: %v err=%v (needs Screen Recording permission on a desktop Mac)", func() any {
		if img == nil {
			return nil
		}
		return img.Bounds()
	}(), err)
}

func TestDarwinLock(t *testing.T) {
	t.Setenv("PEOPLEHUB_AGENT_HOME", t.TempDir())
	unlock, err := acquireLock()
	if err != nil {
		t.Fatal(err)
	}
	if !isRunning() {
		t.Error("lock should be held")
	}
	unlock()
	if isRunning() {
		t.Error("lock should be released")
	}
}

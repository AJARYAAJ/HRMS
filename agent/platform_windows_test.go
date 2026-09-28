package main

import (
	"os"
	"path/filepath"
	"testing"
)

// These run on a real Windows machine (GitHub Actions windows-latest) and exercise the Win32 calls.
func TestWindowsPlatform(t *testing.T) {
	p, err := newPlatform()
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	idle, err := p.IdleSeconds()
	if err != nil || idle < 0 {
		t.Fatalf("IdleSeconds = %v, %v", idle, err)
	}
	t.Logf("idle: %.1fs", idle)
	w, err := p.Foreground()
	t.Logf("foreground: %+v err=%v (a CI runner may have no foreground window)", w, err)
	img, err := p.Screenshot()
	if err != nil {
		t.Logf("screenshot unavailable on this runner: %v", err)
	} else {
		if img.Bounds().Dx() < 100 {
			t.Fatalf("screenshot too small: %v", img.Bounds())
		}
		data, err := encodeScreenshot(img, 1600, 70)
		if err != nil || len(data) == 0 {
			t.Fatalf("encode: %v", err)
		}
		t.Logf("screenshot %v, %d KB JPEG", img.Bounds(), len(data)/1024)
	}
}

func TestWindowsFriendlyNames(t *testing.T) {
	wp := &windowsPlatform{names: map[string]string{}}
	win := os.Getenv("SystemRoot")
	if got := wp.friendlyName(filepath.Join(win, "explorer.exe")); got != "File Explorer" {
		t.Errorf("explorer.exe -> %q", got)
	}
	// Read from the executable's version resource.
	got := wp.friendlyName(filepath.Join(win, "System32", "cmd.exe"))
	if got == "" || got == "cmd" {
		t.Errorf("cmd.exe description not read: %q", got)
	}
	t.Logf("cmd.exe -> %q", got)
}

func TestWindowsLockAndAutostart(t *testing.T) {
	t.Setenv("PEOPLEHUB_AGENT_HOME", t.TempDir())
	unlock, err := acquireLock()
	if err != nil {
		t.Fatal(err)
	}
	if !isRunning() {
		t.Error("second instance should see the first")
	}
	unlock()
	if isRunning() {
		t.Error("lock should be released")
	}
	had := autostartInstalled()
	if err := installAutostart(`C:\Program Files\PeopleHub Test\peoplehub-agent.exe`); err != nil {
		t.Fatal(err)
	}
	if !autostartInstalled() {
		t.Error("Run value not found after install")
	}
	if err := removeAutostart(); err != nil {
		t.Fatal(err)
	}
	if autostartInstalled() && !had {
		t.Error("Run value still present after uninstall")
	}
}

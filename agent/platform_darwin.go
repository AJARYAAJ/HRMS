package main

import (
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/png"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// macOS implementation using built-in command-line tools, so the agent needs no compiled Objective-C:
//
//	lsappinfo     – frontmost application (no permission needed)
//	ioreg         – seconds since the last keyboard/mouse input
//	osascript     – window title (Accessibility permission) and browser tab URL (Automation permission)
//	screencapture – screenshots (Screen Recording permission)
type darwinPlatform struct {
	mu         sync.Mutex
	titlesOff  bool
	browserOff map[string]bool
	warned     map[string]bool
}

func newPlatform() (Platform, error) {
	return &darwinPlatform{browserOff: map[string]bool{}, warned: map[string]bool{}}, nil
}

func (p *darwinPlatform) Close() {}

func run(timeout time.Duration, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	b, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	if ctx.Err() != nil {
		return "", fmt.Errorf("%s timed out", name)
	}
	return strings.TrimSpace(string(b)), err
}

var idleRe = regexp.MustCompile(`"HIDIdleTime"\s*=\s*(\d+)`)

func (p *darwinPlatform) IdleSeconds() (float64, error) {
	s, err := run(3*time.Second, "/usr/sbin/ioreg", "-c", "IOHIDSystem", "-r", "-d", "1", "-k", "HIDIdleTime")
	if err != nil {
		return 0, err
	}
	return parseHIDIdle(s)
}

func parseHIDIdle(s string) (float64, error) {
	m := idleRe.FindStringSubmatch(s)
	if m == nil {
		return 0, errors.New("HIDIdleTime not found")
	}
	ns, err := strconv.ParseFloat(m[1], 64)
	return ns / 1e9, err
}

var lsNameRe = regexp.MustCompile(`"(?:LSDisplayName|name)"\s*=\s*"([^"]*)"`)

func parseLsappinfoName(s string) string {
	if m := lsNameRe.FindStringSubmatch(s); m != nil {
		return m[1]
	}
	return ""
}

func (p *darwinPlatform) Foreground() (Window, error) {
	asn, err := run(2*time.Second, "/usr/bin/lsappinfo", "front")
	if err != nil || asn == "" {
		return Window{}, fmt.Errorf("lsappinfo front: %v", err)
	}
	info, err := run(2*time.Second, "/usr/bin/lsappinfo", "info", "-only", "name", asn)
	if err != nil {
		return Window{}, fmt.Errorf("lsappinfo info: %v", err)
	}
	w := Window{App: parseLsappinfoName(info)}
	if w.App == "" {
		return w, errors.New("could not read the application name")
	}
	w.Title = p.title(w.App)
	if isBrowser(w.App) {
		w.URL = p.browserURL(w.App)
	}
	return w, nil
}

// title needs Accessibility permission; without it macOS returns error -1719/-25211 and titles are skipped.
func (p *darwinPlatform) title(app string) string {
	p.mu.Lock()
	off := p.titlesOff
	p.mu.Unlock()
	if off {
		return ""
	}
	script := fmt.Sprintf(`tell application "System Events" to tell (first process whose frontmost is true) to get name of front window`)
	s, err := run(2*time.Second, "/usr/bin/osascript", "-e", script)
	if err != nil {
		if strings.Contains(s, "-1719") || strings.Contains(s, "-25211") || strings.Contains(s, "-1743") || strings.Contains(s, "not allowed") {
			p.mu.Lock()
			p.titlesOff = true
			p.mu.Unlock()
		}
		return ""
	}
	return s
}

var urlScripts = map[string]string{
	"safari":         `tell application "Safari" to return URL of front document`,
	"google chrome":  `tell application "Google Chrome" to return URL of active tab of front window`,
	"microsoft edge": `tell application "Microsoft Edge" to return URL of active tab of front window`,
	"brave browser":  `tell application "Brave Browser" to return URL of active tab of front window`,
	"chromium":       `tell application "Chromium" to return URL of active tab of front window`,
	"vivaldi":        `tell application "Vivaldi" to return URL of active tab of front window`,
	"opera":          `tell application "Opera" to return URL of active tab of front window`,
	"arc":            `tell application "Arc" to return URL of active tab of front window`,
}

// browserURL asks the browser for its active tab (Automation permission, asked once per browser).
// Firefox has no scripting interface, so only the app is recorded for it.
func (p *darwinPlatform) browserURL(app string) string {
	key := strings.ToLower(app)
	script, ok := urlScripts[key]
	p.mu.Lock()
	off := p.browserOff[key]
	p.mu.Unlock()
	if !ok || off {
		return ""
	}
	s, err := run(2*time.Second, "/usr/bin/osascript", "-e", script)
	if err != nil {
		if strings.Contains(s, "-1743") || strings.Contains(s, "Not authorized") {
			p.mu.Lock()
			p.browserOff[key] = true
			p.mu.Unlock()
		}
		return ""
	}
	return s
}

// Screenshot captures the main display. Without Screen Recording permission macOS returns only the wallpaper.
func (p *darwinPlatform) Screenshot() (image.Image, error) {
	f := filepath.Join(os.TempDir(), fmt.Sprintf("peoplehub-%d.png", time.Now().UnixNano()))
	defer os.Remove(f)
	if out, err := run(15*time.Second, "/usr/sbin/screencapture", "-x", "-t", "png", "-D", "1", f); err != nil {
		return nil, fmt.Errorf("screencapture: %v %s", err, out)
	}
	fh, err := os.Open(f)
	if err != nil {
		return nil, err
	}
	defer fh.Close()
	img, _, err := image.Decode(fh)
	return img, err
}

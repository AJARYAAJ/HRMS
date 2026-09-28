//go:build !windows && !darwin

package main

import (
	"image"
	"image/color"
	"os"
	"time"
)

// Linux and other systems are not supported targets. PEOPLEHUB_AGENT_FAKE=1 enables a scripted platform
// used by the automated tests and for trying the agent against a server from a Linux machine.
func newPlatform() (Platform, error) {
	if os.Getenv("PEOPLEHUB_AGENT_FAKE") == "1" {
		return &fakePlatform{start: time.Now()}, nil
	}
	return nil, errUnsupported
}

type fakePlatform struct{ start time.Time }

var fakeWindows = []Window{
	{App: "Visual Studio Code", Title: "agent.go — hrms"},
	{App: "Google Chrome", Title: "Pull request #42 · GitHub", URL: "https://github.com/AJARYAAJ/hrms/pull/42"},
	{App: "Slack", Title: "#engineering"},
	{App: "Google Chrome", Title: "YouTube", URL: "https://www.youtube.com/watch?v=x"},
}

func (f *fakePlatform) Foreground() (Window, error) {
	i := int(time.Since(f.start)/(20*time.Second)) % len(fakeWindows)
	return fakeWindows[i], nil
}

func (f *fakePlatform) IdleSeconds() (float64, error) {
	if s := os.Getenv("PEOPLEHUB_AGENT_FAKE_IDLE"); s != "" {
		d, err := time.ParseDuration(s)
		return d.Seconds(), err
	}
	return 1, nil
}

func (f *fakePlatform) Screenshot() (image.Image, error) {
	img := image.NewRGBA(image.Rect(0, 0, 640, 360))
	for y := 0; y < 360; y++ {
		for x := 0; x < 640; x++ {
			img.Set(x, y, color.RGBA{uint8(x / 3), uint8(y / 2), 180, 255})
		}
	}
	return img, nil
}

func (f *fakePlatform) Close() {}

func binDir() (string, error)       { return homeDir() }
func binaryName() string            { return "peoplehub-agent" }
func installAutostart(string) error { return errUnsupported }
func removeAutostart() error        { return nil }
func autostartInstalled() bool      { return false }
func stopLaunchd()                  {}
func startBackground() error        { return spawnDetached() }

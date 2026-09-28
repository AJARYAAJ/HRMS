package main

import (
	"errors"
	"image"
	"strings"
)

// Window is the application in focus.
type Window struct {
	App   string // friendly name, e.g. "Google Chrome"
	Title string // window title (may be empty if the OS denies access)
	URL   string // active tab URL for supported browsers (best effort); only the domain is ever sent
}

// Platform is implemented per OS (platform_windows.go, platform_darwin.go).
type Platform interface {
	Foreground() (Window, error)
	IdleSeconds() (float64, error)
	Screenshot() (image.Image, error)
	Close()
}

var errUnsupported = errors.New("activity tracking is not supported on this operating system")

var browsers = map[string]bool{
	"google chrome": true, "chrome": true, "microsoft edge": true, "msedge": true, "brave browser": true, "brave": true,
	"safari": true, "firefox": true, "mozilla firefox": true, "opera": true, "vivaldi": true, "arc": true, "chromium": true,
}

func isBrowser(app string) bool { return browsers[strings.ToLower(app)] }

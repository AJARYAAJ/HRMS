package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"time"
)

// TrayState is what the tray icon shows; the agent provides a fresh snapshot on demand.
type TrayState struct {
	Status         string // starting, tracking, idle, away, paused, stopped
	Connected      bool   // false while uploads are failing (events are queued)
	LastUpload     time.Time
	Queued         int
	Screenshots    bool
	ScreenshotMins int
	PausedUntil    time.Time
	AllowPause     bool
	Server         string
	EmployeeID     int
	Version        string
}

// trayBackend is implemented by *Agent; the tray talks to it through this interface.
type trayBackend interface {
	TrayState() TrayState
	Pause(d time.Duration)
	Resume()
}

const (
	menuPause15 = iota + 1
	menuPause60
	menuResume
	menuMyActivity
	menuOpenPeopleHub
)

type menuEntry struct {
	ID        int // 0 = informational (disabled) line
	Label     string
	Separator bool
}

func statusLabel(s TrayState) string {
	switch s.Status {
	case "tracking":
		return "Tracking activity"
	case "idle":
		return "Idle"
	case "away":
		return "Away — not recording"
	case "paused":
		return "Paused until " + s.PausedUntil.Local().Format("15:04")
	case "stopped":
		return "Stopped — device not authorised"
	default:
		return "Starting…"
	}
}

func ago(t time.Time, now time.Time) string {
	if t.IsZero() {
		return "not yet"
	}
	d := now.Sub(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%d min ago", int(d.Minutes()))
	default:
		return t.Local().Format("15:04")
	}
}

// trayMenu builds the menu shown by both the Windows and macOS tray icons.
func trayMenu(s TrayState, now time.Time) []menuEntry {
	upload := "Last upload: " + ago(s.LastUpload, now)
	if !s.Connected {
		upload = fmt.Sprintf("Offline — %d events waiting to upload", s.Queued)
	}
	shots := "Screenshots: off"
	if s.Screenshots {
		shots = fmt.Sprintf("Screenshots: on (about every %d min)", s.ScreenshotMins)
	}
	m := []menuEntry{
		{Label: "PeopleHub · " + statusLabel(s)},
		{Label: upload},
		{Label: shots},
		{Separator: true},
	}
	if s.AllowPause && s.Status != "stopped" {
		if s.Status == "paused" {
			m = append(m, menuEntry{ID: menuResume, Label: "Resume tracking"})
		} else {
			m = append(m, menuEntry{ID: menuPause15, Label: "Pause for 15 minutes"}, menuEntry{ID: menuPause60, Label: "Pause for 1 hour"})
		}
		m = append(m, menuEntry{Separator: true})
	}
	if s.EmployeeID > 0 {
		m = append(m, menuEntry{ID: menuMyActivity, Label: "View my activity"})
	}
	m = append(m, menuEntry{ID: menuOpenPeopleHub, Label: "Open PeopleHub"}, menuEntry{Separator: true}, menuEntry{Label: "Agent version " + s.Version})
	return m
}

func trayTooltip(s TrayState, now time.Time) string {
	t := "PeopleHub — " + statusLabel(s)
	if !s.Connected {
		t += " (offline)"
	} else if !s.LastUpload.IsZero() {
		t += "\nLast upload " + ago(s.LastUpload, now)
	}
	return t
}

// handleMenu runs a menu command. openURL is the OS-specific browser launcher.
func handleMenu(b trayBackend, id int, openURL func(string)) {
	s := b.TrayState()
	switch id {
	case menuPause15:
		b.Pause(15 * time.Minute)
	case menuPause60:
		b.Pause(time.Hour)
	case menuResume:
		b.Resume()
	case menuMyActivity:
		openURL(fmt.Sprintf("%s/productivity/%d", s.Server, s.EmployeeID))
	case menuOpenPeopleHub:
		openURL(s.Server)
	}
}

// iconKey reduces a state to the few icon variants that exist.
func iconKey(s TrayState) string {
	switch {
	case s.Status == "stopped":
		return "error"
	case !s.Connected:
		return "offline"
	case s.Status == "tracking":
		return "active"
	case s.Status == "idle" || s.Status == "paused":
		return "idle"
	default:
		return "away"
	}
}

var dotColors = map[string]color.RGBA{
	"active":  {0x16, 0xa3, 0x4a, 255}, // green
	"idle":    {0xf5, 0x9e, 0x0b, 255}, // amber
	"away":    {0x94, 0xa3, 0xb8, 255}, // slate
	"offline": {0x94, 0xa3, 0xb8, 255},
	"error":   {0xdc, 0x26, 0x26, 255}, // red
}

// trayIcon draws the PeopleHub mark (an indigo disc with three activity bars) with a status dot, supersampled
// 4× and box-filtered down so edges are smooth at 16–36 px.
func trayIcon(size int, key string) *image.RGBA {
	const ss = 4
	n := size * ss
	big := image.NewRGBA(image.Rect(0, 0, n, n))
	brand := color.RGBA{0x4f, 0x46, 0xe5, 255}
	white := color.RGBA{255, 255, 255, 255}
	dot := dotColors[key]
	f := float64(n)
	disc := func(cx, cy, r float64, c color.RGBA) {
		for y := 0; y < n; y++ {
			for x := 0; x < n; x++ {
				dx, dy := float64(x)+0.5-cx, float64(y)+0.5-cy
				if dx*dx+dy*dy <= r*r {
					big.SetRGBA(x, y, c)
				}
			}
		}
	}
	rect := func(x0, y0, x1, y1 float64, c color.RGBA) {
		for y := int(y0); y < int(y1); y++ {
			for x := int(x0); x < int(x1); x++ {
				big.SetRGBA(x, y, c)
			}
		}
	}
	disc(f*0.46, f*0.5, f*0.44, brand)
	// Activity bars.
	bw := f * 0.09
	base := f * 0.7
	for i, h := range []float64{0.2, 0.36, 0.28} {
		x := f*0.2 + float64(i)*f*0.13
		rect(x, base-h*f, x+bw, base, white)
	}
	// Status dot with a transparent ring so it reads on any menu bar or taskbar colour.
	cx, cy := f*0.77, f*0.77
	ring := f * 0.23
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			dx, dy := float64(x)+0.5-cx, float64(y)+0.5-cy
			if dx*dx+dy*dy <= ring*ring {
				big.SetRGBA(x, y, color.RGBA{})
			}
		}
	}
	disc(cx, cy, f*0.17, dot)
	// Box-filter down, keeping alpha (downscale() in imageutil.go drops it).
	out := image.NewRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			var r, g, b, a uint32
			for yy := 0; yy < ss; yy++ {
				for xx := 0; xx < ss; xx++ {
					p := big.RGBAAt(x*ss+xx, y*ss+yy)
					r, g, b, a = r+uint32(p.R), g+uint32(p.G), b+uint32(p.B), a+uint32(p.A)
				}
			}
			out.SetRGBA(x, y, color.RGBA{uint8(r / (ss * ss)), uint8(g / (ss * ss)), uint8(b / (ss * ss)), uint8(a / (ss * ss))})
		}
	}
	return out
}

// pngWithDPI encodes a PNG carrying a pHYs chunk, so macOS sizes a 2× image at half its pixel size.
func pngWithDPI(img image.Image, dpi float64) ([]byte, error) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	b := buf.Bytes()
	const ihdrEnd = 8 + 8 + 13 + 4 // signature + IHDR chunk
	ppm := uint32(dpi / 0.0254)
	data := make([]byte, 9)
	binary.BigEndian.PutUint32(data[0:], ppm)
	binary.BigEndian.PutUint32(data[4:], ppm)
	data[8] = 1 // unit: metre
	chunk := make([]byte, 0, 21)
	chunk = binary.BigEndian.AppendUint32(chunk, 9)
	typed := append([]byte("pHYs"), data...)
	chunk = append(chunk, typed...)
	chunk = binary.BigEndian.AppendUint32(chunk, crc32.ChecksumIEEE(typed))
	out := append([]byte{}, b[:ihdrEnd]...)
	out = append(out, chunk...)
	return append(out, b[ihdrEnd:]...), nil
}

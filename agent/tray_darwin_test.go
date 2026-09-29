package main

import (
	"os"
	"testing"
	"time"

	"github.com/ebitengine/purego/objc"
)

var macTrayResult string

// TestMain runs on the main thread (see init in tray_darwin.go), which AppKit requires, so the menu bar
// item is created here before the ordinary tests run.
func TestMain(m *testing.M) {
	macTrayResult = macTraySmoke()
	os.Exit(m.Run())
}

func macTraySmoke() string {
	pool := cls("NSAutoreleasePool").Send(sel("alloc")).Send(sel("init"))
	defer pool.Send(sel("drain"))
	b := &fakeBackend{s: TrayState{Status: "tracking", Connected: true, AllowPause: true, Server: "https://hr.example.com", EmployeeID: 3, Version: "test", LastUpload: time.Now()}}
	tr, err := newMacTray(b)
	if err != nil {
		return "skip: " + err.Error()
	}
	defer tr.remove()
	menu := tr.item.Send(sel("menu"))
	n := objc.Send[int](menu, sel("numberOfItems"))
	if want := len(trayMenu(b.TrayState(), time.Now())); n != want {
		return "menu has " + itoa(n) + " items, want " + itoa(want)
	}
	if tr.item.Send(sel("button")).Send(sel("image")) == 0 {
		return "status item has no image"
	}
	b.s.Status = "paused"
	b.s.PausedUntil = time.Now().Add(time.Hour)
	tr.refresh(false)
	if tr.lastKey != "idle" {
		return "icon not refreshed: " + tr.lastKey
	}
	return "ok"
}

func itoa(n int) string { return string(rune('0'+n/10)) + string(rune('0'+n%10)) }

func TestMacTray(t *testing.T) {
	switch {
	case macTrayResult == "ok":
		t.Log("menu bar item created with icon and menu; refresh works")
	case len(macTrayResult) > 5 && macTrayResult[:5] == "skip:":
		t.Skip(macTrayResult)
	default:
		t.Fatal(macTrayResult)
	}
}

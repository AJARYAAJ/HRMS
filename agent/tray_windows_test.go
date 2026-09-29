package main

import (
	"runtime"
	"testing"
	"time"
	"unsafe"
)

func TestNotifyIconDataLayout(t *testing.T) {
	// sizeof(NOTIFYICONDATAW) on 64-bit Windows; a mismatch would make Shell_NotifyIcon reject the call.
	if unsafe.Sizeof(uintptr(0)) == 8 && unsafe.Sizeof(notifyIconData{}) != 976 {
		t.Fatalf("NOTIFYICONDATAW is %d bytes, want 976", unsafe.Sizeof(notifyIconData{}))
	}
}

// Creates the real notification-area icon and menu on the Windows runner.
func TestWindowsTray(t *testing.T) {
	b := &fakeBackend{s: TrayState{Status: "tracking", Connected: true, AllowPause: true, Server: "https://hr.example.com", EmployeeID: 3, Version: "test", LastUpload: time.Now()}}
	done := make(chan struct{})
	result := make(chan string, 1)
	go func() {
		runtime.LockOSThread()
		tr, err := newWinTray(b)
		if tr == nil {
			result <- "no tray: " + err.Error()
			return
		}
		defer tr.close()
		if !tr.added {
			result <- "icon not added (no shell on this runner): " + errText(err)
			return
		}
		menu := tr.buildMenu()
		n, _, _ := pGetMenuItemCount.Call(menu)
		pDestroyMenu.Call(menu)
		if int(n) != len(trayMenu(b.TrayState(), time.Now())) {
			result <- "menu item count mismatch"
			return
		}
		b.s.Status, b.s.Connected = "paused", false
		tr.refresh()
		if tr.lastKey != "offline" {
			result <- "refresh did not switch the icon: " + tr.lastKey
			return
		}
		result <- "ok"
		<-done
	}()
	r := <-result
	close(done)
	switch {
	case r == "ok":
		t.Log("tray icon added, menu built, icon refreshed")
	case len(r) > 7 && (r[:7] == "no tray" || r[:4] == "icon"):
		t.Skip(r)
	default:
		t.Fatal(r)
	}
}

package main

import (
	"errors"
	"fmt"
	"os"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

var (
	shell32 = syscall.NewLazyDLL("shell32.dll")

	pShellNotifyIconW       = shell32.NewProc("Shell_NotifyIconW")
	pShellExecuteW          = shell32.NewProc("ShellExecuteW")
	pRegisterClassExW       = user32.NewProc("RegisterClassExW")
	pCreateWindowExW        = user32.NewProc("CreateWindowExW")
	pDefWindowProcW         = user32.NewProc("DefWindowProcW")
	pGetMessageW            = user32.NewProc("GetMessageW")
	pTranslateMessage       = user32.NewProc("TranslateMessage")
	pDispatchMessageW       = user32.NewProc("DispatchMessageW")
	pPostMessageW           = user32.NewProc("PostMessageW")
	pPostQuitMessage        = user32.NewProc("PostQuitMessage")
	pDestroyWindow          = user32.NewProc("DestroyWindow")
	pCreatePopupMenu        = user32.NewProc("CreatePopupMenu")
	pAppendMenuW            = user32.NewProc("AppendMenuW")
	pTrackPopupMenu         = user32.NewProc("TrackPopupMenu")
	pDestroyMenu            = user32.NewProc("DestroyMenu")
	pGetMenuItemCount       = user32.NewProc("GetMenuItemCount")
	pSetForegroundWindow    = user32.NewProc("SetForegroundWindow")
	pGetCursorPos           = user32.NewProc("GetCursorPos")
	pSetTimer               = user32.NewProc("SetTimer")
	pRegisterWindowMessageW = user32.NewProc("RegisterWindowMessageW")
	pCreateIconFromResource = user32.NewProc("CreateIconFromResourceEx")
	pDestroyIcon            = user32.NewProc("DestroyIcon")
	pGetModuleHandleW       = kernel32.NewProc("GetModuleHandleW")
)

const (
	wmDestroy     = 0x0002
	wmClose       = 0x0010
	wmNull        = 0x0000
	wmTimer       = 0x0113
	wmContextMenu = 0x007B
	wmLButtonUp   = 0x0202
	wmRButtonUp   = 0x0205
	wmApp         = 0x8000
	wmTray        = wmApp + 1

	nimAdd     = 0
	nimModify  = 1
	nimDelete  = 2
	nifMessage = 0x1
	nifIcon    = 0x2
	nifTip     = 0x4
	nifInfo    = 0x10
	niifInfo   = 0x1

	mfString       = 0x0
	mfGrayed       = 0x1
	mfSeparator    = 0x800
	tpmReturnCmd   = 0x100
	tpmNoNotify    = 0x80
	tpmRightAlign  = 0x8
	tpmBottomAlign = 0x20
)

type wndClassEx struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     uintptr
	hIcon         uintptr
	hCursor       uintptr
	hbrBackground uintptr
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       uintptr
}

type notifyIconData struct {
	cbSize           uint32
	hWnd             uintptr
	uID              uint32
	uFlags           uint32
	uCallbackMessage uint32
	hIcon            uintptr
	szTip            [128]uint16
	dwState          uint32
	dwStateMask      uint32
	szInfo           [256]uint16
	uVersion         uint32
	szInfoTitle      [64]uint16
	dwInfoFlags      uint32
	guidItem         [16]byte
	hBalloonIcon     uintptr
}

type point struct{ x, y int32 }

type msg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      point
	private uint32
}

// winTray owns the notification-area icon. All of its methods run on the tray's locked OS thread.
type winTray struct {
	backend        trayBackend
	hwnd           uintptr
	icons          map[string]uintptr
	lastKey        string
	lastTip        string
	taskbarCreated uint32
	added          bool
}

var (
	activeTray  *winTray // the window procedure is a single shared callback
	wndProcOnce sync.Once
	wndProcPtr  uintptr
)

func copyUTF16(dst []uint16, s string) {
	u, _ := syscall.UTF16FromString(s)
	if len(u) > len(dst) {
		u = append(u[:len(dst)-1], 0)
	}
	copy(dst, u)
}

func (t *winTray) icon(key string) uintptr {
	if h, ok := t.icons[key]; ok {
		return h
	}
	const smCXSmIcon = 49
	size, _, _ := pGetSystemMetrics.Call(smCXSmIcon) // already DPI-scaled for a DPI-aware process
	if size == 0 {
		size = 16
	}
	data, err := pngWithDPI(trayIcon(int(size), key), 96)
	if err != nil {
		return 0
	}
	h, _, _ := pCreateIconFromResource.Call(uintptr(unsafe.Pointer(&data[0])), uintptr(len(data)), 1, 0x00030000, size, size, 0)
	runtime.KeepAlive(data)
	t.icons[key] = h
	return h
}

func (t *winTray) notify(action uintptr, flags uint32, s TrayState, info string) bool {
	nid := notifyIconData{hWnd: t.hwnd, uID: 1, uFlags: flags, uCallbackMessage: wmTray}
	nid.cbSize = uint32(unsafe.Sizeof(nid))
	if flags&nifIcon != 0 {
		nid.hIcon = t.icon(iconKey(s))
	}
	if flags&nifTip != 0 {
		copyUTF16(nid.szTip[:], trayTooltip(s, time.Now()))
	}
	if flags&nifInfo != 0 {
		copyUTF16(nid.szInfoTitle[:], "PeopleHub agent is running")
		copyUTF16(nid.szInfo[:], info)
		nid.dwInfoFlags = niifInfo
	}
	r, _, _ := pShellNotifyIconW.Call(action, uintptr(unsafe.Pointer(&nid)))
	return r != 0
}

func (t *winTray) add() bool {
	s := t.backend.TrayState()
	t.added = t.notify(nimAdd, nifMessage|nifIcon|nifTip, s, "")
	t.lastKey, t.lastTip = iconKey(s), trayTooltip(s, time.Now())
	return t.added
}

// refresh updates the icon and tooltip only when they change (called every 2 s by a timer).
func (t *winTray) refresh() {
	s := t.backend.TrayState()
	key, tip := iconKey(s), trayTooltip(s, time.Now())
	if !t.added {
		t.add()
		return
	}
	if key != t.lastKey || tip != t.lastTip {
		t.notify(nimModify, nifIcon|nifTip, s, "")
		t.lastKey, t.lastTip = key, tip
	}
}

// buildMenu creates the popup menu for the current state. The caller destroys it.
func (t *winTray) buildMenu() uintptr {
	menu, _, _ := pCreatePopupMenu.Call()
	for _, e := range trayMenu(t.backend.TrayState(), time.Now()) {
		switch {
		case e.Separator:
			pAppendMenuW.Call(menu, mfSeparator, 0, 0)
		case e.ID == 0:
			pAppendMenuW.Call(menu, mfString|mfGrayed, 0, uintptr(unsafe.Pointer(utf16Ptr(e.Label))))
		default:
			pAppendMenuW.Call(menu, mfString, uintptr(e.ID), uintptr(unsafe.Pointer(utf16Ptr(e.Label))))
		}
	}
	return menu
}

func (t *winTray) showMenu() {
	menu := t.buildMenu()
	defer pDestroyMenu.Call(menu)
	var p point
	pGetCursorPos.Call(uintptr(unsafe.Pointer(&p)))
	pSetForegroundWindow.Call(t.hwnd) // required so the menu closes when clicking elsewhere
	id, _, _ := pTrackPopupMenu.Call(menu, tpmReturnCmd|tpmNoNotify|tpmRightAlign|tpmBottomAlign, uintptr(p.x), uintptr(p.y), 0, t.hwnd, 0)
	pPostMessageW.Call(t.hwnd, wmNull, 0, 0)
	if id != 0 {
		handleMenu(t.backend, int(id), openURL)
	}
}

func openURL(u string) {
	pShellExecuteW.Call(0, uintptr(unsafe.Pointer(utf16Ptr("open"))), uintptr(unsafe.Pointer(utf16Ptr(u))), 0, 0, 1)
}

func wndProc(hwnd, message, wParam, lParam uintptr) uintptr {
	t := activeTray
	if t != nil {
		switch {
		case message == wmTray:
			switch lParam & 0xFFFF {
			case wmLButtonUp, wmRButtonUp, wmContextMenu:
				t.showMenu()
			}
			return 0
		case message == wmTimer:
			t.refresh()
			return 0
		case t.taskbarCreated != 0 && message == uintptr(t.taskbarCreated):
			t.add() // Explorer restarted: the icon must be added again
			return 0
		case message == wmClose:
			t.notify(nimDelete, 0, TrayState{}, "")
			pDestroyWindow.Call(hwnd)
			return 0
		case message == wmDestroy:
			pPostQuitMessage.Call(0)
			return 0
		}
	}
	r, _, _ := pDefWindowProcW.Call(hwnd, message, wParam, lParam)
	return r
}

// newWinTray creates the hidden window and the notification-area icon. Must run on the thread that will
// pump its messages.
func newWinTray(b trayBackend) (*winTray, error) {
	wndProcOnce.Do(func() { wndProcPtr = syscall.NewCallback(wndProc) })
	inst, _, _ := pGetModuleHandleW.Call(0)
	class := utf16Ptr("PeopleHubAgentTray")
	wc := wndClassEx{lpfnWndProc: wndProcPtr, hInstance: inst, lpszClassName: class}
	wc.cbSize = uint32(unsafe.Sizeof(wc))
	pRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc))) // fails harmlessly if already registered
	hwnd, _, err := pCreateWindowExW.Call(0, uintptr(unsafe.Pointer(class)), uintptr(unsafe.Pointer(utf16Ptr("PeopleHub Agent"))), 0, 0, 0, 0, 0, 0, 0, inst, 0)
	if hwnd == 0 {
		return nil, fmt.Errorf("CreateWindowEx: %w", err)
	}
	tb, _, _ := pRegisterWindowMessageW.Call(uintptr(unsafe.Pointer(utf16Ptr("TaskbarCreated"))))
	t := &winTray{backend: b, hwnd: hwnd, icons: map[string]uintptr{}, taskbarCreated: uint32(tb)}
	activeTray = t
	if !t.add() {
		return t, errors.New("the notification area is not available (no Explorer shell?) — will retry")
	}
	return t, nil
}

func (t *winTray) close() {
	t.notify(nimDelete, 0, TrayState{}, "")
	pDestroyWindow.Call(t.hwnd)
	for _, h := range t.icons {
		pDestroyIcon.Call(h)
	}
	activeTray = nil
}

// runUI shows the tray icon while the agent runs. The tray lives on its own locked OS thread with a
// Win32 message loop; the agent keeps running (and the icon is simply absent) if the shell isn't there.
func runUI(a *Agent, run func() error) error {
	done := make(chan struct{})
	exited := make(chan struct{})
	go func() {
		defer close(exited)
		runtime.LockOSThread()
		t, err := newWinTray(a)
		if t == nil {
			a.logger.Printf("tray icon unavailable: %v", err)
			<-done
			return
		}
		if err != nil {
			a.logger.Printf("%v", err)
		}
		welcome := pathIn("tray-welcome")
		if _, err := os.Stat(welcome); os.IsNotExist(err) && t.added {
			t.notify(nimModify, nifInfo, a.TrayState(), "Activity on this computer is shared with PeopleHub. Click the icon for status and options.")
			_ = os.WriteFile(welcome, []byte(time.Now().Format(time.RFC3339)), 0o600)
		}
		pSetTimer.Call(t.hwnd, 1, 2000, 0)
		go func() { <-done; pPostMessageW.Call(t.hwnd, wmClose, 0, 0) }()
		var m msg
		for {
			r, _, _ := pGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
			if int32(r) <= 0 {
				break
			}
			pTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
			pDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
		}
		for _, h := range t.icons {
			pDestroyIcon.Call(h)
		}
		activeTray = nil
	}()
	err := run()
	close(done)
	select {
	case <-exited:
	case <-time.After(3 * time.Second):
	}
	return err
}

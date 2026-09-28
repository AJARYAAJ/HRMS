package main

import (
	"errors"
	"fmt"
	"image"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"unsafe"
)

type windowsPlatform struct {
	mu      sync.Mutex
	names   map[string]string // exe path -> friendly name
	browser *browserURLReader
}

func newPlatform() (Platform, error) {
	// Physical pixels for screenshots on scaled displays: per-monitor v2 (Windows 10 1703+), else system aware.
	if pSetProcessDpiAwarenessCtx.Find() == nil {
		r, _, _ := pSetProcessDpiAwarenessCtx.Call(^uintptr(3)) // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
		if r == 0 {
			pSetProcessDPIAware.Call()
		}
	} else {
		pSetProcessDPIAware.Call()
	}
	return &windowsPlatform{names: map[string]string{}, browser: newBrowserURLReader()}, nil
}

func (p *windowsPlatform) Close() { p.browser.Close() }

type lastInputInfo struct {
	cbSize uint32
	dwTime uint32
}

func (p *windowsPlatform) IdleSeconds() (float64, error) {
	li := lastInputInfo{cbSize: uint32(unsafe.Sizeof(lastInputInfo{}))}
	if r, _, err := pGetLastInputInfo.Call(ptr(&li)); r == 0 {
		return 0, fmt.Errorf("GetLastInputInfo: %w", err)
	}
	now, _, _ := pGetTickCount.Call()
	return float64(uint32(now)-li.dwTime) / 1000, nil // uint32 arithmetic handles the 49.7-day wrap
}

func (p *windowsPlatform) Foreground() (Window, error) {
	hwnd, _, _ := pGetForegroundWindow.Call()
	if hwnd == 0 {
		return Window{}, errors.New("no foreground window (locked or switching desktops)")
	}
	title := windowText(hwnd)
	pid := windowPID(hwnd)
	exe := processPath(pid)
	// UWP apps are hosted by ApplicationFrameHost; the real app is a child window owned by another process.
	if strings.EqualFold(filepath.Base(exe), "ApplicationFrameHost.exe") {
		if child := childProcessOf(hwnd, pid); child != 0 {
			if e := processPath(child); e != "" {
				exe = e
			}
		}
	}
	w := Window{App: p.friendlyName(exe), Title: title}
	if w.App == "" {
		w.App = "Unknown"
	}
	if isBrowser(w.App) {
		w.URL = p.browser.URL(hwnd, title)
	}
	return w, nil
}

func windowText(hwnd uintptr) string {
	n, _, _ := pGetWindowTextLengthW.Call(hwnd)
	if n == 0 {
		return ""
	}
	buf := make([]uint16, n+1)
	pGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), n+1)
	return syscall.UTF16ToString(buf)
}

func windowPID(hwnd uintptr) uint32 {
	var pid uint32
	pGetWindowThreadProcessId.Call(hwnd, ptr(&pid))
	return pid
}

func processPath(pid uint32) string {
	const processQueryLimitedInformation = 0x1000
	h, _, _ := pOpenProcess.Call(processQueryLimitedInformation, 0, uintptr(pid))
	if h == 0 {
		return ""
	}
	defer syscall.CloseHandle(syscall.Handle(h))
	buf := make([]uint16, 1024)
	size := uint32(len(buf))
	if r, _, _ := pQueryFullProcessImageNameW.Call(h, 0, uintptr(unsafe.Pointer(&buf[0])), ptr(&size)); r == 0 {
		return ""
	}
	return syscall.UTF16ToString(buf[:size])
}

// EnumChildWindows needs a callback; Go callbacks can't be freed, so one shared callback is created once.
var (
	enumMu     sync.Mutex
	enumParent uint32
	enumFound  uint32
	enumCB     = syscall.NewCallback(func(hwnd, _ uintptr) uintptr {
		if pid := windowPID(hwnd); pid != 0 && pid != enumParent {
			enumFound = pid
			return 0
		}
		return 1
	})
)

func childProcessOf(hwnd uintptr, parent uint32) uint32 {
	enumMu.Lock()
	defer enumMu.Unlock()
	enumParent, enumFound = parent, 0
	pEnumChildWindows.Call(hwnd, enumCB, 0)
	return enumFound
}

var knownApps = map[string]string{
	"chrome.exe": "Google Chrome", "msedge.exe": "Microsoft Edge", "firefox.exe": "Firefox", "brave.exe": "Brave Browser",
	"code.exe": "Visual Studio Code", "explorer.exe": "File Explorer", "winword.exe": "Microsoft Word",
	"excel.exe": "Microsoft Excel", "powerpnt.exe": "Microsoft PowerPoint", "outlook.exe": "Microsoft Outlook",
	"ms-teams.exe": "Microsoft Teams", "teams.exe": "Microsoft Teams", "slack.exe": "Slack", "zoom.exe": "Zoom",
}

// friendlyName prefers well-known names, then the executable's FileDescription, then the file name.
func (p *windowsPlatform) friendlyName(exe string) string {
	if exe == "" {
		return ""
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if n, ok := p.names[exe]; ok {
		return n
	}
	base := strings.ToLower(filepath.Base(exe))
	name := knownApps[base]
	if name == "" {
		name = fileDescription(exe)
	}
	if name == "" {
		name = strings.TrimSuffix(filepath.Base(exe), filepath.Ext(exe))
	}
	p.names[exe] = name
	return name
}

func fileDescription(exe string) string {
	path := utf16Ptr(exe)
	size, _, _ := pGetFileVersionInfoSizeW.Call(uintptr(unsafe.Pointer(path)), 0)
	if size == 0 {
		return ""
	}
	data := make([]byte, size)
	if r, _, _ := pGetFileVersionInfoW.Call(uintptr(unsafe.Pointer(path)), 0, size, uintptr(unsafe.Pointer(&data[0]))); r == 0 {
		return ""
	}
	var tr *[2]uint16
	var trLen uint32
	if r, _, _ := pVerQueryValueW.Call(uintptr(unsafe.Pointer(&data[0])), uintptr(unsafe.Pointer(utf16Ptr(`\VarFileInfo\Translation`))), uintptr(unsafe.Pointer(&tr)), ptr(&trLen)); r == 0 || trLen < 4 {
		return ""
	}
	key := fmt.Sprintf(`\StringFileInfo\%04x%04x\FileDescription`, tr[0], tr[1])
	var val *uint16
	var valLen uint32
	if r, _, _ := pVerQueryValueW.Call(uintptr(unsafe.Pointer(&data[0])), uintptr(unsafe.Pointer(utf16Ptr(key))), uintptr(unsafe.Pointer(&val)), ptr(&valLen)); r == 0 || valLen == 0 {
		return ""
	}
	return strings.TrimSpace(syscall.UTF16ToString(unsafe.Slice(val, valLen)))
}

type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

type bitmapInfo struct {
	Header bitmapInfoHeader
	Colors [1]uint32
}

// Screenshot captures the whole virtual desktop (all monitors) with GDI.
func (p *windowsPlatform) Screenshot() (image.Image, error) {
	const (
		smXVirtual, smYVirtual, smCXVirtual, smCYVirtual = 76, 77, 78, 79
		srcCopy, captureBlt                              = 0x00CC0020, 0x40000000
	)
	metric := func(i uintptr) int32 { r, _, _ := pGetSystemMetrics.Call(i); return int32(r) }
	x, y, w, h := metric(smXVirtual), metric(smYVirtual), metric(smCXVirtual), metric(smCYVirtual)
	if w <= 0 || h <= 0 {
		return nil, errors.New("no display available")
	}
	screen, _, _ := pGetDC.Call(0)
	if screen == 0 {
		return nil, errors.New("GetDC failed")
	}
	defer pReleaseDC.Call(0, screen)
	mem, _, _ := pCreateCompatibleDC.Call(screen)
	if mem == 0 {
		return nil, errors.New("CreateCompatibleDC failed")
	}
	defer pDeleteDC.Call(mem)
	bmp, _, _ := pCreateCompatibleBitmap.Call(screen, uintptr(w), uintptr(h))
	if bmp == 0 {
		return nil, errors.New("CreateCompatibleBitmap failed")
	}
	defer pDeleteObject.Call(bmp)
	old, _, _ := pSelectObject.Call(mem, bmp)
	r, _, err := pBitBlt.Call(mem, 0, 0, uintptr(w), uintptr(h), screen, uintptr(x), uintptr(y), srcCopy|captureBlt)
	pSelectObject.Call(mem, old) // GetDIBits requires the bitmap not to be selected into a DC
	if r == 0 {
		return nil, fmt.Errorf("BitBlt: %w", err)
	}
	bi := bitmapInfo{Header: bitmapInfoHeader{Width: w, Height: -h, Planes: 1, BitCount: 32}} // top-down BGRA
	bi.Header.Size = uint32(unsafe.Sizeof(bi.Header))
	buf := make([]byte, int(w)*int(h)*4)
	if r, _, err := pGetDIBits.Call(mem, bmp, 0, uintptr(h), uintptr(unsafe.Pointer(&buf[0])), ptr(&bi), 0); r == 0 {
		return nil, fmt.Errorf("GetDIBits: %w", err)
	}
	img := image.NewRGBA(image.Rect(0, 0, int(w), int(h)))
	for i := 0; i < len(buf); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = buf[i+2], buf[i+1], buf[i], 255
	}
	return img, nil
}

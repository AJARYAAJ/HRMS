package main

import (
	"syscall"
	"unsafe"
)

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	gdi32    = syscall.NewLazyDLL("gdi32.dll")
	advapi32 = syscall.NewLazyDLL("advapi32.dll")
	versionD = syscall.NewLazyDLL("version.dll")

	pGetForegroundWindow       = user32.NewProc("GetForegroundWindow")
	pGetWindowTextW            = user32.NewProc("GetWindowTextW")
	pGetWindowTextLengthW      = user32.NewProc("GetWindowTextLengthW")
	pGetWindowThreadProcessId  = user32.NewProc("GetWindowThreadProcessId")
	pGetLastInputInfo          = user32.NewProc("GetLastInputInfo")
	pEnumChildWindows          = user32.NewProc("EnumChildWindows")
	pGetDC                     = user32.NewProc("GetDC")
	pReleaseDC                 = user32.NewProc("ReleaseDC")
	pGetSystemMetrics          = user32.NewProc("GetSystemMetrics")
	pSetProcessDPIAware        = user32.NewProc("SetProcessDPIAware")
	pSetProcessDpiAwarenessCtx = user32.NewProc("SetProcessDpiAwarenessContext")
	pMessageBoxW               = user32.NewProc("MessageBoxW")

	pOpenProcess                = kernel32.NewProc("OpenProcess")
	pQueryFullProcessImageNameW = kernel32.NewProc("QueryFullProcessImageNameW")
	pGetTickCount               = kernel32.NewProc("GetTickCount")
	pAttachConsole              = kernel32.NewProc("AttachConsole")
	pCreateMutexW               = kernel32.NewProc("CreateMutexW")
	pCreateEventW               = kernel32.NewProc("CreateEventW")
	pOpenEventW                 = kernel32.NewProc("OpenEventW")
	pSetEvent                   = kernel32.NewProc("SetEvent")

	pCreateCompatibleDC     = gdi32.NewProc("CreateCompatibleDC")
	pCreateCompatibleBitmap = gdi32.NewProc("CreateCompatibleBitmap")
	pSelectObject           = gdi32.NewProc("SelectObject")
	pBitBlt                 = gdi32.NewProc("BitBlt")
	pGetDIBits              = gdi32.NewProc("GetDIBits")
	pDeleteObject           = gdi32.NewProc("DeleteObject")
	pDeleteDC               = gdi32.NewProc("DeleteDC")

	pRegCreateKeyExW = advapi32.NewProc("RegCreateKeyExW")
	pRegSetValueExW  = advapi32.NewProc("RegSetValueExW")
	pRegDeleteValueW = advapi32.NewProc("RegDeleteValueW")

	pGetFileVersionInfoSizeW = versionD.NewProc("GetFileVersionInfoSizeW")
	pGetFileVersionInfoW     = versionD.NewProc("GetFileVersionInfoW")
	pVerQueryValueW          = versionD.NewProc("VerQueryValueW")
)

func utf16Ptr(s string) *uint16 {
	p, _ := syscall.UTF16PtrFromString(s)
	return p
}

func ptr[T any](v *T) uintptr { return uintptr(unsafe.Pointer(v)) }

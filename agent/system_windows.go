package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"
)

// setupConsole: the Windows build is a GUI-subsystem program so login start-up never shows a console.
// When launched from a terminal, attach to it so commands can print; otherwise output goes to a message box.
func setupConsole() bool {
	if st, err := os.Stdout.Stat(); err == nil && (st.Mode()&os.ModeNamedPipe != 0 || st.Mode().IsRegular() || st.Mode()&os.ModeCharDevice != 0) {
		return true // output is redirected to a pipe or file, or a console was inherited
	}
	const attachParentProcess = ^uintptr(0)
	if r, _, _ := pAttachConsole.Call(attachParentProcess); r == 0 {
		return false
	}
	if f, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0); err == nil {
		os.Stdout, os.Stderr = f, f
		out = f
		fmt.Fprintln(f)
	}
	return true
}

func showMessage(title, msg string, isErr bool) {
	flags := uintptr(0x40) // MB_ICONINFORMATION
	if isErr {
		flags = 0x10 // MB_ICONERROR
	}
	pMessageBoxW.Call(0, uintptr(unsafe.Pointer(utf16Ptr(msg))), uintptr(unsafe.Pointer(utf16Ptr(title))), flags)
}

const (
	mutexName = `Local\PeopleHubAgent`
	stopEvent = `Local\PeopleHubAgentStop`
)

func acquireLock() (func(), error) {
	h, _, err := pCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(utf16Ptr(mutexName))))
	if h == 0 {
		return nil, fmt.Errorf("CreateMutex: %w", err)
	}
	if errors.Is(err, syscall.ERROR_ALREADY_EXISTS) {
		syscall.CloseHandle(syscall.Handle(h))
		return nil, errors.New("the agent is already running")
	}
	return func() { syscall.CloseHandle(syscall.Handle(h)) }, nil
}

// stopChannel is closed when `setup`, `uninstall` or `reset` asks the running agent to stop gracefully.
func stopChannel() <-chan struct{} {
	ch := make(chan struct{})
	h, _, _ := pCreateEventW.Call(0, 1, 0, uintptr(unsafe.Pointer(utf16Ptr(stopEvent))))
	if h == 0 {
		return ch
	}
	go func() {
		syscall.WaitForSingleObject(syscall.Handle(h), syscall.INFINITE)
		close(ch)
	}()
	return ch
}

func stopRunning() {
	if !isRunning() {
		return
	}
	const eventModifyState = 0x0002
	if h, _, _ := pOpenEventW.Call(eventModifyState, 0, uintptr(unsafe.Pointer(utf16Ptr(stopEvent)))); h != 0 {
		pSetEvent.Call(h)
		syscall.CloseHandle(syscall.Handle(h))
	}
	for i := 0; i < 50 && isRunning(); i++ {
		time.Sleep(100 * time.Millisecond)
	}
	if isRunning() {
		if st, err := loadState(); err == nil && st.PID > 0 {
			if p, err := os.FindProcess(st.PID); err == nil {
				p.Kill()
				time.Sleep(500 * time.Millisecond)
			}
		}
	}
}

func startBackground() error {
	exe := installedExe()
	if _, err := os.Stat(exe); err != nil {
		exe, _ = os.Executable()
	}
	cmd := exec.Command(exe, "run")
	const detachedProcess, createNewProcessGroup, createNoWindow = 0x00000008, 0x00000200, 0x08000000
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: detachedProcess | createNewProcessGroup | createNoWindow}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("could not start the agent: %w", err)
	}
	return cmd.Process.Release()
}

func binDir() (string, error) {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		return "", errors.New("LOCALAPPDATA is not set")
	}
	d := filepath.Join(base, "PeopleHub")
	return d, os.MkdirAll(d, 0o700)
}

func binaryName() string { return "peoplehub-agent.exe" }

const runKey = `Software\Microsoft\Windows\CurrentVersion\Run`
const runValue = "PeopleHubAgent"

func openRunKey() (syscall.Handle, error) {
	const keySetValue, keyQueryValue = 0x0002, 0x0001
	var h syscall.Handle
	if r, _, _ := pRegCreateKeyExW.Call(uintptr(syscall.HKEY_CURRENT_USER), uintptr(unsafe.Pointer(utf16Ptr(runKey))), 0, 0, 0,
		keySetValue|keyQueryValue, 0, uintptr(unsafe.Pointer(&h)), 0); r != 0 {
		return 0, fmt.Errorf("could not open the Run registry key (error %d)", r)
	}
	return h, nil
}

// installAutostart registers the agent under HKCU\...\Run, which starts it at login in the user's session
// (a Windows service can't see the user's desktop, so it can't be used for activity tracking).
func installAutostart(exe string) error {
	h, err := openRunKey()
	if err != nil {
		return err
	}
	defer syscall.RegCloseKey(h)
	cmdline, _ := syscall.UTF16FromString(`"` + exe + `" run`)
	const regSZ = 1
	if r, _, _ := pRegSetValueExW.Call(uintptr(h), uintptr(unsafe.Pointer(utf16Ptr(runValue))), 0, regSZ,
		uintptr(unsafe.Pointer(&cmdline[0])), uintptr(len(cmdline)*2)); r != 0 {
		return fmt.Errorf("could not write the Run registry value (error %d)", r)
	}
	return nil
}

func removeAutostart() error {
	h, err := openRunKey()
	if err != nil {
		return err
	}
	defer syscall.RegCloseKey(h)
	if r, _, _ := pRegDeleteValueW.Call(uintptr(h), uintptr(unsafe.Pointer(utf16Ptr(runValue)))); r != 0 && r != 2 { // 2 = not found
		return fmt.Errorf("could not remove the Run registry value (error %d)", r)
	}
	return nil
}

func autostartInstalled() bool {
	h, err := openRunKey()
	if err != nil {
		return false
	}
	defer syscall.RegCloseKey(h)
	var typ, size uint32
	return syscall.RegQueryValueEx(h, utf16Ptr(runValue), nil, &typ, nil, &size) == nil
}

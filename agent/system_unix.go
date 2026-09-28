//go:build !windows

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"
)

func setupConsole() bool { return true }

func showMessage(title, msg string, isErr bool) { fmt.Println(msg) }

func acquireLock() (func(), error) {
	f, err := os.OpenFile(pathIn("agent.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		return nil, errors.New("the agent is already running")
	}
	return func() { syscall.Flock(int(f.Fd()), syscall.LOCK_UN); f.Close() }, nil
}

// On Unix the running agent handles SIGTERM itself (see cmdRun), so no extra stop channel is needed.
func stopChannel() <-chan struct{} { return nil }

func stopRunning() {
	if !isRunning() {
		return
	}
	stopLaunchd()
	st, err := loadState()
	if err == nil && st.PID > 0 {
		syscall.Kill(st.PID, syscall.SIGTERM)
	}
	for i := 0; i < 60 && isRunning(); i++ {
		time.Sleep(100 * time.Millisecond)
	}
	if isRunning() && err == nil && st.PID > 0 {
		syscall.Kill(st.PID, syscall.SIGKILL)
	}
}

// spawnDetached starts `<exe> run` in its own session, detached from the terminal.
func spawnDetached() error {
	exe := installedExe()
	if _, err := os.Stat(exe); err != nil {
		exe, _ = os.Executable()
	}
	cmd := exec.Command(exe, "run")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	devnull, _ := os.OpenFile(os.DevNull, os.O_RDWR, 0)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = devnull, devnull, devnull
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("could not start the agent: %w", err)
	}
	return cmd.Process.Release()
}

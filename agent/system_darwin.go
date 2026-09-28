package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const launchLabel = "com.peoplehub.agent"

func binDir() (string, error) { return homeDir() }

func binaryName() string { return "peoplehub-agent" }

func plistPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "LaunchAgents", launchLabel+".plist")
}

func guiDomain() string { return fmt.Sprintf("gui/%d", os.Getuid()) }

func xmlEscape(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(s)
}

// installAutostart writes a per-user LaunchAgent: it runs in the login session (required to see the
// frontmost app), starts at login, and is restarted by launchd if it crashes (not when stopped cleanly).
func installAutostart(exe string) error {
	logDir, _ := homeDir()
	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>%s</string>
  <key>ProgramArguments</key><array><string>%s</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardErrorPath</key><string>%s</string>
</dict>
</plist>
`, launchLabel, xmlEscape(exe), xmlEscape(filepath.Join(logDir, "launchd.log")))
	if err := os.MkdirAll(filepath.Dir(plistPath()), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(plistPath(), []byte(plist), 0o644); err != nil {
		return err
	}
	exec.Command("/bin/launchctl", "bootout", guiDomain()+"/"+launchLabel).Run()
	if out, err := exec.Command("/bin/launchctl", "bootstrap", guiDomain(), plistPath()).CombinedOutput(); err != nil {
		return fmt.Errorf("launchctl bootstrap: %v %s", err, out)
	}
	return nil
}

func removeAutostart() error {
	exec.Command("/bin/launchctl", "bootout", guiDomain()+"/"+launchLabel).Run()
	if err := os.Remove(plistPath()); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func autostartInstalled() bool {
	_, err := os.Stat(plistPath())
	return err == nil
}

// stopLaunchd unloads the job so launchd doesn't immediately relaunch it; setup/install load it again.
func stopLaunchd() {
	if autostartInstalled() {
		exec.Command("/bin/launchctl", "bootout", guiDomain()+"/"+launchLabel).Run()
	}
}

// startBackground: with the LaunchAgent installed, (re)loading it starts the agent under launchd.
func startBackground() error {
	if autostartInstalled() {
		exec.Command("/bin/launchctl", "bootout", guiDomain()+"/"+launchLabel).Run()
		if out, err := exec.Command("/bin/launchctl", "bootstrap", guiDomain(), plistPath()).CombinedOutput(); err != nil {
			return fmt.Errorf("launchctl bootstrap: %v %s", err, out)
		}
		return nil
	}
	return spawnDetached()
}

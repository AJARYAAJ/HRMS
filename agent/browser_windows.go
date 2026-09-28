package main

import (
	"bufio"
	"encoding/base64"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf16"
)

// Windows has no API for "the URL in the browser", so a hidden PowerShell helper uses UI Automation to read
// the address bar of Chrome, Edge, Brave and Firefox. It runs once per agent, is queried at most every few
// seconds (and only when a browser is focused), and is switched off if it keeps failing.
const uiaScript = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$edit = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $url = ''
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$line)
    $box = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $edit)
    if ($box) {
      $vp = $null
      if ($box.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) { $url = $vp.Current.Value }
    }
  } catch {}
  [Console]::Out.WriteLine(($url -replace '[\r\n]', ''))
  [Console]::Out.Flush()
}
`

type browserURLReader struct {
	mu       sync.Mutex
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	lines    chan string
	failures int
	disabled bool
	lastKey  string
	lastURL  string
	lastAt   time.Time
}

func newBrowserURLReader() *browserURLReader { return &browserURLReader{} }

func (b *browserURLReader) start() error {
	enc := utf16.Encode([]rune(uiaScript))
	raw := make([]byte, len(enc)*2)
	for i, v := range enc {
		raw[i*2], raw[i*2+1] = byte(v), byte(v>>8)
	}
	cmd := exec.Command("powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-EncodedCommand", base64.StdEncoding.EncodeToString(raw))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	lines := make(chan string, 4)
	go func() {
		sc := bufio.NewScanner(stdout)
		for sc.Scan() {
			lines <- sc.Text()
		}
		close(lines)
	}()
	select {
	case l, ok := <-lines:
		if !ok || l != "ready" {
			cmd.Process.Kill()
			return fmt.Errorf("browser helper did not start")
		}
	case <-time.After(20 * time.Second):
		cmd.Process.Kill()
		return fmt.Errorf("browser helper timed out starting")
	}
	b.cmd, b.stdin, b.lines = cmd, stdin, lines
	return nil
}

// URL returns the address-bar text of the browser window, cached per window title and rate-limited.
func (b *browserURLReader) URL(hwnd uintptr, title string) string {
	b.mu.Lock()
	defer b.mu.Unlock()
	key := fmt.Sprintf("%d|%s", hwnd, title)
	if b.disabled || (key == b.lastKey && time.Since(b.lastAt) < 30*time.Second) {
		if key == b.lastKey {
			return b.lastURL
		}
		return ""
	}
	if time.Since(b.lastAt) < 3*time.Second && key != b.lastKey {
		return "" // don't hammer UI Automation while the user flicks between tabs
	}
	if b.cmd == nil {
		if err := b.start(); err != nil {
			b.fail()
			return ""
		}
	}
	if _, err := fmt.Fprintf(b.stdin, "%d\n", hwnd); err != nil {
		b.reset()
		b.fail()
		return ""
	}
	select {
	case url, ok := <-b.lines:
		if !ok {
			b.reset()
			b.fail()
			return ""
		}
		b.failures = 0
		b.lastKey, b.lastURL, b.lastAt = key, strings.TrimSpace(url), time.Now()
		return b.lastURL
	case <-time.After(2500 * time.Millisecond):
		b.reset() // the helper is stuck; a new one is started next time
		b.fail()
		return ""
	}
}

func (b *browserURLReader) fail() {
	b.failures++
	b.lastAt = time.Now()
	if b.failures >= 5 {
		b.disabled = true
	}
}

func (b *browserURLReader) reset() {
	if b.cmd != nil {
		b.cmd.Process.Kill()
		b.cmd.Wait()
	}
	b.cmd, b.stdin, b.lines = nil, nil, nil
}

func (b *browserURLReader) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.reset()
}

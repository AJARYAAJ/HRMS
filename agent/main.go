// Command peoplehub-agent is the PeopleHub desktop activity agent for Windows and macOS.
//
// It reports which application (and, for common browsers, which website domain) is in focus, active vs
// idle time and — only if the organisation enables it — periodic screenshots, to the PeopleHub HRMS.
package main

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"syscall"
	"time"
)

var version = "dev" // set at build time: -ldflags "-X main.version=1.0.0"

// out is where command output goes. On Windows the agent is a GUI-subsystem program (so it never flashes a
// console at login); when started without a console, output is collected and shown in a message box.
var out io.Writer = os.Stdout

func say(format string, a ...any) { fmt.Fprintf(out, format+"\n", a...) }

func main() {
	interactive := setupConsole()
	var buf *bytes.Buffer
	if !interactive {
		buf = &bytes.Buffer{}
		out = buf
	}
	code := dispatch(os.Args[1:])
	if buf != nil && buf.Len() > 0 {
		showMessage("PeopleHub Agent", buf.String(), code != 0)
	}
	os.Exit(code)
}

func dispatch(args []string) int {
	cmd := ""
	if len(args) > 0 {
		cmd, args = args[0], args[1:]
	}
	var err error
	switch cmd {
	case "":
		err = defaultAction()
	case "setup":
		err = cmdSetup(args)
	case "run":
		err = cmdRun()
	case "status":
		err = cmdStatus()
	case "check":
		err = cmdCheck()
	case "install":
		err = cmdInstall()
	case "uninstall":
		err = cmdUninstall()
	case "reset":
		err = cmdReset()
	case "version", "--version", "-v":
		say("peoplehub-agent %s (%s/%s)", version, runtime.GOOS, runtime.GOARCH)
	case "help", "--help", "-h":
		usage()
	default:
		say("Unknown command %q.\n", cmd)
		usage()
		return 2
	}
	if err != nil {
		say("Error: %v", err)
		return 1
	}
	return 0
}

func usage() {
	say(`PeopleHub desktop agent %s

Usage:
  peoplehub-agent setup --server <url> --token <token> [--name <device>]
        Connect this computer, start tracking and start automatically at login.
        Get a token in PeopleHub → Productivity → Devices → Register device.
  peoplehub-agent status      Show connection, last upload and queued events
  peoplehub-agent check       Take one sample now and save a test screenshot (permission check)
  peoplehub-agent run         Run in the foreground (what login start-up runs)
  peoplehub-agent install     Start automatically at login
  peoplehub-agent uninstall   Stop and remove automatic start
  peoplehub-agent reset       Stop, remove start-up and delete the saved token and queue
  peoplehub-agent version

Tip: put the "peoplehub-agent.json" setup file downloaded from PeopleHub next to this program and
open the program — it sets itself up.`, version)
}

// defaultAction runs when the program is opened with no arguments (double-click).
func defaultAction() error {
	if f, prov, ok := findProvisioningFile(); ok {
		say("Found setup file %s", filepath.Base(f))
		err := setup(prov, true, true)
		if err == nil {
			_ = os.Remove(f) // it contains the device token
		}
		return err
	}
	if _, err := loadConfig(); err == nil {
		if !isRunning() {
			if err := startBackground(); err != nil {
				return err
			}
			say("Agent started.\n")
			time.Sleep(time.Second)
		}
		return cmdStatus()
	}
	usage()
	return nil
}

func cmdSetup(args []string) error {
	fs := flag.NewFlagSet("setup", flag.ContinueOnError)
	fs.SetOutput(out)
	server := fs.String("server", "", "PeopleHub URL, e.g. https://hr.example.com")
	token := fs.String("token", "", "device token from PeopleHub → Productivity → Devices")
	name := fs.String("name", "", "device name (optional)")
	noAuto := fs.Bool("no-autostart", false, "do not start automatically at login")
	noStart := fs.Bool("no-start", false, "save the settings but do not start tracking now")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *server == "" || *token == "" {
		return errors.New("both --server and --token are required")
	}
	return setup(Config{Server: *server, Token: strings.TrimSpace(*token), DeviceName: *name}, !*noAuto, !*noStart)
}

func setup(c Config, autostart, start bool) error {
	srv, err := normalizeServer(c.Server)
	if err != nil {
		return err
	}
	c.Server = srv
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	rc, err := NewClient(c.Server, c.Token).Config(ctx)
	if err != nil {
		return fmt.Errorf("could not connect to %s: %w", c.Server, err)
	}
	say("Connected to %s (device #%d).", c.Server, rc.DeviceID)
	if err := saveConfig(c); err != nil {
		return fmt.Errorf("could not save settings: %w", err)
	}
	stopRunning()
	exe, err := installSelf()
	if err != nil {
		return fmt.Errorf("could not install the agent: %w", err)
	}
	if autostart {
		if err := installAutostart(exe); errors.Is(err, errUnsupported) {
			say("Automatic start isn't available on this operating system.")
		} else if err != nil {
			return fmt.Errorf("settings saved, but automatic start could not be enabled: %w", err)
		} else {
			say("Automatic start at login: enabled.")
		}
	}
	if start {
		if err := startBackground(); err != nil {
			return err
		}
		say("Tracking started. Screenshots: %s.", map[bool]string{true: fmt.Sprintf("every ~%d min", rc.ScreenshotIntervalMin), false: "off"}[rc.ScreenshotsEnabled])
	}
	if runtime.GOOS == "darwin" {
		say("\nmacOS: allow \"peoplehub-agent\" under System Settings → Privacy & Security → Accessibility (window titles)%s.",
			map[bool]string{true: " and Screen Recording (screenshots)", false: ""}[rc.ScreenshotsEnabled])
	}
	return nil
}

func cmdRun() error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	unlock, err := acquireLock()
	if err != nil {
		return err
	}
	defer unlock()
	logger, closeLog := openLog()
	defer closeLog()
	p, err := newPlatform()
	if err != nil {
		return err
	}
	defer p.Close()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if ch := stopChannel(); ch != nil {
		go func() { <-ch; stop() }()
	}
	return NewAgent(cfg, p, logger).Run(ctx)
}

func cmdStatus() error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	say("Server:      %s", cfg.Server)
	say("Version:     %s (%s/%s)", version, runtime.GOOS, runtime.GOARCH)
	say("Running:     %v", isRunning())
	say("Auto-start:  %v", autostartInstalled())
	if st, err := loadState(); err == nil {
		if !st.LastHeartbeatAt.IsZero() {
			say("Last upload: %s (%s ago)", st.LastHeartbeatAt.Local().Format("2 Jan 15:04:05"), time.Since(st.LastHeartbeatAt).Round(time.Second))
		}
		if !st.LastScreenshot.IsZero() {
			say("Screenshot:  %s", st.LastScreenshot.Local().Format("2 Jan 15:04:05"))
		}
		say("Queued:      %d events", OpenQueue(pathIn("queue.jsonl"), maxQueued).Len())
		if st.Stopped != "" && !isRunning() {
			say("Stopped:     %s", st.Stopped)
		}
		if st.LastError != "" {
			say("Last error:  %s", st.LastError)
		}
	}
	d, _ := homeDir()
	say("Data folder: %s", d)
	return nil
}

func cmdCheck() error {
	p, err := newPlatform()
	if err != nil {
		return err
	}
	defer p.Close()
	idle, err := p.IdleSeconds()
	say("Idle for:    %.0fs %s", idle, errText(err))
	w, err := p.Foreground()
	say("Application: %s %s", w.App, errText(err))
	say("Title:       %s", w.Title)
	if w.URL != "" {
		say("Website:     %s (only the domain is sent)", domainOf(w.URL))
	}
	img, err := p.Screenshot()
	if err != nil {
		say("Screenshot:  failed: %v", err)
		return nil
	}
	data, err := encodeScreenshot(img, 1600, 70)
	if err != nil {
		return err
	}
	f := pathIn("check-screenshot.jpg")
	if err := os.WriteFile(f, data, 0o600); err != nil {
		return err
	}
	say("Screenshot:  %dx%d saved to %s", img.Bounds().Dx(), img.Bounds().Dy(), f)
	if runtime.GOOS == "darwin" {
		say("             If it shows only the desktop background, grant Screen Recording permission.")
	}
	return nil
}

func cmdInstall() error {
	if _, err := loadConfig(); err != nil {
		return err
	}
	stopRunning()
	exe, err := installSelf()
	if err != nil {
		return err
	}
	if err := installAutostart(exe); err != nil {
		return err
	}
	say("Automatic start at login enabled.")
	return startBackground()
}

func cmdUninstall() error {
	stopRunning()
	if err := removeAutostart(); err != nil {
		return err
	}
	say("Agent stopped and automatic start removed.")
	return nil
}

func cmdReset() error {
	stopRunning()
	_ = removeAutostart()
	for _, f := range []string{"agent.json", "queue.jsonl", "state.json", "check-screenshot.jpg"} {
		_ = os.Remove(pathIn(f))
	}
	say("Agent stopped; settings, token and queued data deleted.")
	return nil
}

func errText(err error) string {
	if err != nil {
		return "(error: " + err.Error() + ")"
	}
	return ""
}

// findProvisioningFile looks for the setup file downloaded from PeopleHub next to the program or in the
// current folder (browsers may rename repeats to "peoplehub-agent (1).json"), newest first.
func findProvisioningFile() (string, Config, bool) {
	var dirs []string
	if exe, err := os.Executable(); err == nil {
		dirs = append(dirs, filepath.Dir(exe))
	}
	if wd, err := os.Getwd(); err == nil {
		dirs = append(dirs, wd)
	}
	type cand struct {
		path string
		mod  time.Time
	}
	var cands []cand
	for _, d := range dirs {
		matches, _ := filepath.Glob(filepath.Join(d, "peoplehub-agent*.json"))
		for _, m := range matches {
			if st, err := os.Stat(m); err == nil {
				cands = append(cands, cand{m, st.ModTime()})
			}
		}
	}
	sort.Slice(cands, func(i, j int) bool { return cands[i].mod.After(cands[j].mod) })
	for _, c := range cands {
		b, err := os.ReadFile(c.path)
		if err != nil {
			continue
		}
		var cfg Config
		if jsonUnmarshal(b, &cfg) == nil && cfg.Server != "" && cfg.Token != "" {
			return c.path, cfg, true
		}
	}
	return "", Config{}, false
}

// installSelf copies the running program to a stable per-user location so login start-up keeps working
// after the download is deleted. Returns the installed path.
func installSelf() (string, error) {
	src, err := os.Executable()
	if err != nil {
		return "", err
	}
	src, _ = filepath.EvalSymlinks(src)
	dir, err := binDir()
	if err != nil {
		return "", err
	}
	dst := filepath.Join(dir, binaryName())
	if same(src, dst) {
		return dst, nil
	}
	data, err := os.ReadFile(src)
	if err != nil {
		return "", err
	}
	tmp := dst + ".new"
	if err := os.WriteFile(tmp, data, 0o755); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, dst); err != nil {
		return "", err
	}
	return dst, nil
}

func same(a, b string) bool {
	sa, err1 := os.Stat(a)
	sb, err2 := os.Stat(b)
	return err1 == nil && err2 == nil && os.SameFile(sa, sb)
}

func installedExe() string {
	dir, err := binDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, binaryName())
}

// openLog writes to agent.log in the data folder (rotated at 5 MB), and to stderr when run in a terminal.
func openLog() (*log.Logger, func()) {
	path := pathIn("agent.log")
	if st, err := os.Stat(path); err == nil && st.Size() > 5<<20 {
		_ = os.Rename(path, path+".1")
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return log.New(os.Stderr, "", log.LstdFlags), func() {}
	}
	var w io.Writer = f
	if out == os.Stdout && isTerminal() {
		w = io.MultiWriter(f, os.Stderr)
	}
	return log.New(w, "", log.LstdFlags), func() { f.Close() }
}

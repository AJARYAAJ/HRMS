package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Config is what `setup` saves: where the HRMS lives and this device's token.
type Config struct {
	Server     string `json:"server"`
	Token      string `json:"token"`
	DeviceName string `json:"device_name,omitempty"`
}

// State is written by the running agent so `status` can report on it.
type State struct {
	PID             int       `json:"pid"`
	StartedAt       time.Time `json:"started_at"`
	LastHeartbeatAt time.Time `json:"last_heartbeat_at,omitempty"`
	LastScreenshot  time.Time `json:"last_screenshot_at,omitempty"`
	LastError       string    `json:"last_error,omitempty"`
	Queued          int       `json:"queued"`
	Stopped         string    `json:"stopped,omitempty"`
}

// homeDir is the per-user data folder: %AppData%\PeopleHub on Windows,
// ~/Library/Application Support/PeopleHub on macOS. PEOPLEHUB_AGENT_HOME overrides it (tests).
func homeDir() (string, error) {
	if d := os.Getenv("PEOPLEHUB_AGENT_HOME"); d != "" {
		return d, os.MkdirAll(d, 0o700)
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	d := filepath.Join(base, "PeopleHub")
	return d, os.MkdirAll(d, 0o700)
}

func pathIn(name string) string {
	d, err := homeDir()
	if err != nil {
		return name
	}
	return filepath.Join(d, name)
}

var errNotConfigured = errors.New("the agent is not set up yet: run `peoplehub-agent setup --server <url> --token <token>`")

func loadConfig() (Config, error) {
	var c Config
	b, err := os.ReadFile(pathIn("agent.json"))
	if errors.Is(err, os.ErrNotExist) {
		return c, errNotConfigured
	}
	if err != nil {
		return c, err
	}
	if err := json.Unmarshal(b, &c); err != nil {
		return c, fmt.Errorf("agent.json is corrupt: %w", err)
	}
	if c.Server == "" || c.Token == "" {
		return c, errNotConfigured
	}
	return c, nil
}

func saveConfig(c Config) error {
	return writeJSON(pathIn("agent.json"), c)
}

// normalizeServer accepts "hr.acme.com", "https://hr.acme.com/" or ".../api" and returns the origin.
func normalizeServer(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", errors.New("server URL is required")
	}
	if !strings.Contains(s, "://") {
		host := strings.SplitN(strings.SplitN(s, "/", 2)[0], ":", 2)[0]
		if host == "localhost" || strings.HasPrefix(host, "127.") {
			s = "http://" + s // local test servers rarely have TLS
		} else {
			s = "https://" + s
		}
	}
	s = strings.TrimRight(s, "/")
	s = strings.TrimSuffix(s, "/api")
	if !strings.HasPrefix(s, "http://") && !strings.HasPrefix(s, "https://") {
		return "", errors.New("server URL must start with http:// or https://")
	}
	return s, nil
}

func loadState() (State, error) {
	var s State
	b, err := os.ReadFile(pathIn("state.json"))
	if err != nil {
		return s, err
	}
	return s, json.Unmarshal(b, &s)
}

func saveState(s State) { _ = writeJSON(pathIn("state.json"), s) }

// writeJSON writes atomically (temp file + rename) with owner-only permissions: the config holds a credential.
func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

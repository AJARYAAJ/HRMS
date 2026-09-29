package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"runtime"
	"time"
)

// RemoteConfig is what the HRMS tells the agent to do (GET /api/agent/config).
type RemoteConfig struct {
	EmployeeID            int  `json:"employee_id"`
	DeviceID              int  `json:"device_id"`
	HeartbeatSeconds      int  `json:"heartbeat_seconds"`
	ScreenshotsEnabled    bool `json:"screenshots_enabled"`
	ScreenshotIntervalMin int  `json:"screenshot_interval_mins"`
	IdleThresholdSeconds  int  `json:"idle_threshold_seconds"`
	AwayAfterMinutes      int  `json:"away_after_minutes"`
	AllowPause            bool `json:"allow_pause"`
}

func (c RemoteConfig) withDefaults() RemoteConfig {
	if c.HeartbeatSeconds < 15 {
		c.HeartbeatSeconds = 60
	}
	if c.ScreenshotIntervalMin < 1 {
		c.ScreenshotIntervalMin = 10
	}
	if c.IdleThresholdSeconds < 30 {
		c.IdleThresholdSeconds = 120
	}
	if c.AwayAfterMinutes < 5 {
		c.AwayAfterMinutes = 60
	}
	return c
}

// AgentInfo is reported with heartbeats so IT can see versions and machines in the HRMS.
type AgentInfo struct {
	Version     string `json:"version"`
	OS          string `json:"os"`
	Hostname    string `json:"hostname"`
	PausedUntil string `json:"paused_until,omitempty"`
	Resumed     bool   `json:"resumed,omitempty"`
}

var (
	errUnauthorized = errors.New("the device token was rejected (revoked or invalid)")
	errForbidden    = errors.New("forbidden")
)

// rejectedError is a 4xx the server won't change its mind about: retrying the same payload is pointless.
type rejectedError struct {
	status int
	msg    string
}

func (e *rejectedError) Error() string {
	return fmt.Sprintf("server rejected the request (%d): %s", e.status, e.msg)
}

type Client struct {
	base  string
	token string
	http  *http.Client
}

func NewClient(server, token string) *Client {
	return &Client{base: server, token: token, http: &http.Client{Timeout: 30 * time.Second}}
}

func (c *Client) do(ctx context.Context, method, path, contentType string, body io.Reader, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, c.base+"/api"+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Device "+c.token)
	req.Header.Set("User-Agent", fmt.Sprintf("PeopleHub-Agent/%s (%s; %s)", version, runtime.GOOS, runtime.GOARCH))
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		if out != nil {
			if err := json.Unmarshal(data, out); err != nil {
				return fmt.Errorf("unexpected response from %s (is this the PeopleHub server?): %w", c.base, err)
			}
		}
		return nil
	}
	var e struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(data, &e)
	switch {
	case res.StatusCode == http.StatusUnauthorized:
		return errUnauthorized
	case res.StatusCode == http.StatusForbidden:
		return fmt.Errorf("%w: %s", errForbidden, e.Error)
	case res.StatusCode >= 400 && res.StatusCode < 500 && res.StatusCode != http.StatusTooManyRequests && res.StatusCode != http.StatusRequestTimeout:
		return &rejectedError{res.StatusCode, e.Error}
	default:
		return fmt.Errorf("server error %d %s", res.StatusCode, e.Error)
	}
}

func (c *Client) Config(ctx context.Context) (RemoteConfig, error) {
	var rc RemoteConfig
	err := c.do(ctx, http.MethodGet, "/agent/config", "", nil, &rc)
	return rc.withDefaults(), err
}

func (c *Client) Heartbeat(ctx context.Context, events []Event, info AgentInfo) error {
	body, err := json.Marshal(map[string]any{"events": events, "agent": info})
	if err != nil {
		return err
	}
	return c.do(ctx, http.MethodPost, "/agent/heartbeat", "application/json", bytes.NewReader(body), nil)
}

func (c *Client) Screenshot(ctx context.Context, jpeg []byte) error {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	h := textproto.MIMEHeader{}
	h.Set("Content-Disposition", `form-data; name="file"; filename="screen.jpg"`)
	h.Set("Content-Type", "image/jpeg")
	part, err := w.CreatePart(h)
	if err != nil {
		return err
	}
	if _, err := part.Write(jpeg); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.do(ctx, http.MethodPost, "/agent/screenshot", w.FormDataContentType(), &buf, nil)
}

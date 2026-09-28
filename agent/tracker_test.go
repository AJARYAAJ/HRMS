package main

import (
	"testing"
	"time"
)

func at(s string) time.Time {
	t, err := time.Parse(time.RFC3339, "2026-09-28T"+s+"Z")
	if err != nil {
		panic(err)
	}
	return t
}

func sum(events []Event) (active, idle int) {
	for _, e := range events {
		active += e.Active
		idle += e.Idle
	}
	return
}

func TestTrackerSplitsSamplesIntoMinutes(t *testing.T) {
	tr := NewTracker(15 * time.Second)
	var got []Event
	code := Sample{App: "Code", Title: "main.go"}
	chrome := Sample{App: "Chrome", Domain: "github.com", Title: "PR"}
	// 10:00:00–10:00:40 Code, 10:00:40–10:01:20 Chrome, then idle until 10:01:40.
	for ts := at("10:00:00"); ts.Before(at("10:01:45")); ts = ts.Add(5 * time.Second) {
		s := code
		switch {
		case !ts.Before(at("10:01:20")):
			s = Sample{Idle: true}
		case !ts.Before(at("10:00:40")):
			s = chrome
		}
		got = append(got, tr.Observe(ts, s)...)
	}
	// Only 10:00 is complete so far.
	if len(got) != 2 {
		t.Fatalf("want 2 events for 10:00, got %+v", got)
	}
	if got[0].App != "Code" || got[0].Active != 40 || got[1].App != "Chrome" || got[1].Active != 20 || got[1].Domain != "github.com" {
		t.Fatalf("unexpected 10:00 events: %+v", got)
	}
	if got[0].TS != "2026-09-28T10:00:00Z" {
		t.Fatalf("bad ts %s", got[0].TS)
	}
	rest := tr.Flush(at("10:01:45"))
	a, i := sum(rest)
	if a != 20 || i != 25 {
		t.Fatalf("10:01 want 20s active + 25s idle, got %d/%d: %+v", a, i, rest)
	}
	if last := rest[len(rest)-1]; last.Idle == 0 {
		t.Fatalf("most recent activity (idle) must be last so the live board shows it: %+v", rest)
	}
}

func TestTrackerIgnoresGaps(t *testing.T) {
	tr := NewTracker(15 * time.Second)
	tr.Observe(at("10:00:00"), Sample{App: "Code"})
	tr.Observe(at("10:00:05"), Sample{App: "Code"})
	// Laptop slept for 20 minutes: that time must not be credited to anything.
	got := tr.Observe(at("10:20:05"), Sample{App: "Code"})
	got = append(got, tr.Flush(at("10:20:10"))...)
	a, _ := sum(got)
	if a != 10 {
		t.Fatalf("want 10s active (5s before sleep, 5s after), got %d: %+v", a, got)
	}
}

func TestTrackerNeverExceedsAMinute(t *testing.T) {
	tr := NewTracker(15 * time.Second)
	var got []Event
	apps := []string{"A", "B", "C"}
	for i, ts := 0, at("09:00:00"); i < 60*12; i, ts = i+1, ts.Add(5*time.Second) {
		got = append(got, tr.Observe(ts, Sample{App: apps[i%3], Idle: i%7 == 0})...)
	}
	perMinute := map[string]int{}
	for _, e := range got {
		perMinute[e.TS] += e.Active + e.Idle
	}
	for ts, n := range perMinute {
		if n > 61 {
			t.Fatalf("%s has %d seconds", ts, n)
		}
	}
	if len(perMinute) != 59 {
		t.Fatalf("want 59 complete minutes, got %d", len(perMinute))
	}
}

func TestDomainOf(t *testing.T) {
	cases := map[string]string{
		"https://www.GitHub.com/a/b?x=1": "github.com",
		"docs.google.com/document/d/1":   "docs.google.com",
		"http://localhost:5173/":         "localhost",
		"about:blank":                    "",
		"chrome://settings":              "",
		"search for cats":                "",
		"":                               "",
		"file:///C:/x.pdf":               "",
	}
	for in, want := range cases {
		if got := domainOf(in); got != want {
			t.Errorf("domainOf(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNormalizeServer(t *testing.T) {
	cases := map[string]string{
		"hr.acme.com":               "https://hr.acme.com",
		"https://hr.acme.com/":      "https://hr.acme.com",
		"http://localhost:4000/api": "http://localhost:4000",
		"localhost:4000":            "http://localhost:4000",
	}
	for in, want := range cases {
		if got, err := normalizeServer(in); err != nil || got != want {
			t.Errorf("normalizeServer(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	if _, err := normalizeServer("ftp://x"); err == nil {
		t.Error("ftp scheme should be rejected")
	}
}

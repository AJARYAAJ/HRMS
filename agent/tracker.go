package main

import (
	"net/url"
	"sort"
	"strings"
	"time"
)

// Event matches the HRMS agent API: one row per app/site per minute.
type Event struct {
	TS     string `json:"ts"`
	App    string `json:"app,omitempty"`
	Domain string `json:"domain,omitempty"`
	Title  string `json:"title,omitempty"`
	Active int    `json:"active_seconds"`
	Idle   int    `json:"idle_seconds"`
}

// Sample is one observation of what's in focus.
type Sample struct {
	App    string
	Title  string
	Domain string
	Idle   bool
}

type bucketKey struct{ app, domain string }

type bucketAcc struct {
	title  string
	active float64
	idle   float64
	last   time.Time
}

// Tracker turns frequent samples into per-minute events. Time between two samples is credited to the
// earlier sample; gaps longer than maxGap (sleep, hibernate, a stalled process) are not credited at all.
type Tracker struct {
	maxGap   time.Duration
	minute   time.Time
	buckets  map[bucketKey]*bucketAcc
	prev     *Sample
	prevTime time.Time
}

func NewTracker(maxGap time.Duration) *Tracker {
	return &Tracker{maxGap: maxGap, buckets: map[bucketKey]*bucketAcc{}}
}

// Observe records a sample taken at `now` and returns events for any minutes that are complete.
func (t *Tracker) Observe(now time.Time, s Sample) []Event {
	var out []Event
	if t.prev != nil {
		gap := now.Sub(t.prevTime)
		if gap > 0 && gap <= t.maxGap {
			out = append(out, t.credit(t.prevTime, now, *t.prev)...)
		}
	}
	cur := s
	t.prev, t.prevTime = &cur, now
	if m := now.Truncate(time.Minute); !t.minute.IsZero() && m.After(t.minute) {
		out = append(out, t.flushMinute()...)
		t.minute = m
	}
	if t.minute.IsZero() {
		t.minute = now.Truncate(time.Minute)
	}
	return out
}

// credit splits [from, to) across minute boundaries so every second lands in the right minute.
func (t *Tracker) credit(from, to time.Time, s Sample) []Event {
	var out []Event
	for from.Before(to) {
		m := from.Truncate(time.Minute)
		if t.minute.IsZero() {
			t.minute = m
		}
		if m.After(t.minute) {
			out = append(out, t.flushMinute()...)
			t.minute = m
		}
		end := m.Add(time.Minute)
		if end.After(to) {
			end = to
		}
		t.add(s, end.Sub(from).Seconds(), end)
		from = end
	}
	return out
}

func (t *Tracker) add(s Sample, secs float64, at time.Time) {
	k := bucketKey{s.App, s.Domain}
	if s.Idle {
		k = bucketKey{}
	}
	b := t.buckets[k]
	if b == nil {
		b = &bucketAcc{}
		t.buckets[k] = b
	}
	if s.Idle {
		b.idle += secs
	} else {
		b.active += secs
		if s.Title != "" {
			b.title = s.Title
		}
	}
	b.last = at
}

func (t *Tracker) flushMinute() []Event {
	if len(t.buckets) == 0 {
		return nil
	}
	ts := t.minute.UTC().Format(time.RFC3339)
	type kv struct {
		k bucketKey
		b *bucketAcc
	}
	rows := make([]kv, 0, len(t.buckets))
	for k, b := range t.buckets {
		rows = append(rows, kv{k, b})
	}
	// Most recent last: the HRMS live board reads the last event of the latest minute as "current".
	sort.Slice(rows, func(i, j int) bool { return rows[i].b.last.Before(rows[j].b.last) })
	out := make([]Event, 0, len(rows))
	for _, r := range rows {
		e := Event{TS: ts, App: r.k.app, Domain: r.k.domain, Title: r.b.title, Active: int(r.b.active + 0.5), Idle: int(r.b.idle + 0.5)}
		if e.Active+e.Idle == 0 {
			continue
		}
		out = append(out, e)
	}
	t.buckets = map[bucketKey]*bucketAcc{}
	return out
}

// Flush credits time up to `now` and returns everything recorded so far, including a partial minute.
func (t *Tracker) Flush(now time.Time) []Event {
	var out []Event
	if t.prev != nil && now.Sub(t.prevTime) <= t.maxGap {
		out = append(out, t.credit(t.prevTime, now, *t.prev)...)
	}
	t.prev = nil
	out = append(out, t.flushMinute()...)
	t.minute = time.Time{}
	return out
}

// domainOf reduces a URL (or bare host) to "example.com" — the path and query never leave the device.
func domainOf(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.ContainsAny(raw, " \t") {
		return ""
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return ""
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return ""
	}
	h := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	if !strings.Contains(h, ".") && h != "localhost" {
		return ""
	}
	return h
}

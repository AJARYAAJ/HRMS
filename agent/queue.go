package main

import (
	"bufio"
	"encoding/json"
	"os"
	"sync"
	"time"
)

// Queue keeps events on disk until the server accepts them, so nothing is lost while offline.
// The server only accepts events from the last 7 days, and the queue is capped in size.
type Queue struct {
	mu     sync.Mutex
	path   string
	max    int
	events []Event
}

const maxEventAge = 7*24*time.Hour - time.Hour

func OpenQueue(path string, max int) *Queue {
	q := &Queue{path: path, max: max}
	if f, err := os.Open(path); err == nil {
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			var e Event
			if json.Unmarshal(sc.Bytes(), &e) == nil {
				q.events = append(q.events, e)
			}
		}
		f.Close()
	}
	q.prune(time.Now())
	return q
}

func (q *Queue) Len() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.events)
}

func (q *Queue) Push(events ...Event) error {
	if len(events) == 0 {
		return nil
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	q.events = append(q.events, events...)
	q.prune(time.Now())
	return q.persist()
}

// Peek returns up to n of the oldest events without removing them.
func (q *Queue) Peek(n int) []Event {
	q.mu.Lock()
	defer q.mu.Unlock()
	if n > len(q.events) {
		n = len(q.events)
	}
	out := make([]Event, n)
	copy(out, q.events[:n])
	return out
}

// Drop removes the n oldest events (after the server accepted or permanently rejected them).
func (q *Queue) Drop(n int) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	if n > len(q.events) {
		n = len(q.events)
	}
	q.events = append([]Event(nil), q.events[n:]...)
	return q.persist()
}

func (q *Queue) prune(now time.Time) {
	cut := 0
	for cut < len(q.events) {
		ts, err := time.Parse(time.RFC3339, q.events[cut].TS)
		if err == nil && now.Sub(ts) < maxEventAge {
			break
		}
		cut++
	}
	if extra := len(q.events) - cut - q.max; extra > 0 {
		cut += extra
	}
	if cut > 0 {
		q.events = append([]Event(nil), q.events[cut:]...)
	}
}

func (q *Queue) persist() error {
	tmp := q.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	w := bufio.NewWriter(f)
	enc := json.NewEncoder(w)
	for _, e := range q.events {
		if err := enc.Encode(e); err != nil {
			f.Close()
			return err
		}
	}
	if err := w.Flush(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, q.path)
}

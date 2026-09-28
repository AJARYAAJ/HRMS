package main

import (
	"path/filepath"
	"testing"
	"time"
)

func TestQueuePersistsAndDrops(t *testing.T) {
	path := filepath.Join(t.TempDir(), "q.jsonl")
	now := time.Now().UTC()
	q := OpenQueue(path, 100)
	old := Event{TS: now.Add(-8 * 24 * time.Hour).Format(time.RFC3339), App: "old", Active: 1}
	fresh := []Event{{TS: now.Format(time.RFC3339), App: "a", Active: 10}, {TS: now.Format(time.RFC3339), App: "b", Active: 20}}
	if err := q.Push(append([]Event{old}, fresh...)...); err != nil {
		t.Fatal(err)
	}
	if q.Len() != 2 {
		t.Fatalf("events older than 7 days should be pruned, len=%d", q.Len())
	}
	q2 := OpenQueue(path, 100) // survives a restart
	if q2.Len() != 2 || q2.Peek(1)[0].App != "a" {
		t.Fatalf("queue not persisted: %+v", q2.Peek(5))
	}
	if err := q2.Drop(1); err != nil {
		t.Fatal(err)
	}
	if q3 := OpenQueue(path, 100); q3.Len() != 1 || q3.Peek(1)[0].App != "b" {
		t.Fatalf("drop not persisted")
	}
}

func TestQueueCap(t *testing.T) {
	q := OpenQueue(filepath.Join(t.TempDir(), "q.jsonl"), 3)
	ts := time.Now().UTC().Format(time.RFC3339)
	for _, a := range []string{"1", "2", "3", "4", "5"} {
		_ = q.Push(Event{TS: ts, App: a, Active: 1})
	}
	if got := q.Peek(10); len(got) != 3 || got[0].App != "3" {
		t.Fatalf("oldest events should be dropped at the cap: %+v", got)
	}
}

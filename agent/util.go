package main

import (
	"encoding/json"
	"os"
)

func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }

func isTerminal() bool {
	st, err := os.Stdout.Stat()
	return err == nil && st.Mode()&os.ModeCharDevice != 0
}

// isRunning reports whether another agent process holds the single-instance lock.
func isRunning() bool {
	unlock, err := acquireLock()
	if err != nil {
		return true
	}
	unlock()
	return false
}

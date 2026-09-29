//go:build !windows && !darwin

package main

// No tray on other systems: the agent simply runs.
func runUI(a *Agent, run func() error) error { return run() }

//go:build !darwin

package main

// workArea is macOS-only; zeroes leave the default window size untouched.
func workArea() (int, int) { return 0, 0 }

//go:build !darwin

package main

// setPageZoom is macOS-only: everywhere else kaja is a page in a browser, which zooms
// itself.
func setPageZoom(zoom float64) {}

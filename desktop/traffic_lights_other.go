//go:build !darwin

package main

// alignTrafficLights is macOS-only: nothing else draws window buttons inside
// the app's own chrome.
func alignTrafficLights(bandHeight int) {}

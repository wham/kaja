//go:build !ios

package main

// Every other platform delivers a link as ApplicationLaunchedWithUrl.
func onOpenURL(func(string)) {}

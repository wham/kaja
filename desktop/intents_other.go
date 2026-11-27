//go:build !ios

package main

const appIntents = false

const mcpListenerAlways = false

func serveIntents(*App) {}

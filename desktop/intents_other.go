//go:build !ios

package main

const appIntents = false

const mcpListener = true

func serveIntents(*App) {}

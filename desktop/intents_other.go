//go:build !ios

package main

const appIntents = false

func serveIntents(*App) {}

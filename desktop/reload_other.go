//go:build !ios

package main

func (a *App) reloadWindow() {
	a.window.Reload()
}

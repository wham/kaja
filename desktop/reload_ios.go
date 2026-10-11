//go:build ios

package main

// Wails' iOS window leaves Reload a no-op, so the page reloads itself.
func (a *App) reloadWindow() {
	a.window.ExecJS("window.location.reload()")
}

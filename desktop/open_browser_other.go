//go:build !ios

package main

func (a *App) openInBrowser(url string) error {
	return a.app.Browser.OpenURL(url)
}

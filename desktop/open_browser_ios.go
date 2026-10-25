//go:build ios

package main

import "github.com/wailsapp/wails/v3/pkg/application"

// Wails' Browser.OpenURL spawns `open`, which a phone hasn't got and its sandbox
// wouldn't run; UIKit is what hands a URL to Safari.
func (a *App) openInBrowser(url string) error {
	application.IOS.OpenURL(url)
	return nil
}

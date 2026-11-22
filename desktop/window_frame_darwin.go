//go:build darwin && !ios

package main

/*
#cgo LDFLAGS: -framework Cocoa

// Defined in window_frame_darwin.m.
void kajaRememberWindowFrame(void *window);
*/
import "C"

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// A hook rather than a listener: hooks run before the listener Wails shows the window
// from, so the frame is restored while the window is still hidden.
func rememberWindowFrame(window *application.WebviewWindow) {
	window.RegisterHook(events.Mac.WebViewDidFinishNavigation, func(*application.WindowEvent) {
		application.InvokeSync(func() {
			if native := window.NativeWindow(); native != nil {
				C.kajaRememberWindowFrame(native)
			}
		})
	})
}

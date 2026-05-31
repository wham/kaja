//go:build darwin

package main

/*
#cgo LDFLAGS: -framework Cocoa

// Defined in services_darwin.m. Declared (not defined) here because this file
// uses //export, whose preamble may only contain declarations.
void registerKajaService(void);
*/
import "C"

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// serviceContext is captured at registration so the exported callback can emit
// Wails events back into the running app.
var serviceContext context.Context

//export goServiceRunScript
func goServiceRunScript(text *C.char) {
	if serviceContext == nil {
		return
	}
	selected := C.GoString(text)
	// Bring the app to the front so the user sees the script run, then hand the
	// selected text to the UI to run against the pinned script.
	runtime.WindowUnminimise(serviceContext)
	runtime.WindowShow(serviceContext)
	runtime.EventsEmit(serviceContext, "service:runScript", selected)
}

// registerServices wires up the macOS "Run Kaja Script" text service. It is a
// no-op on other platforms.
func registerServices(ctx context.Context) {
	serviceContext = ctx
	C.registerKajaService()
}

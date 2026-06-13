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
func goServiceRunScript(slot *C.char, text *C.char) {
	if serviceContext == nil {
		return
	}
	slotNumber := C.GoString(slot)
	selected := C.GoString(text)
	// macOS calls this on the main thread inside the synchronous service handler.
	// Wails runtime calls dispatch to the main thread internally, so invoking them
	// here would block it against itself. Run them from a goroutine instead, which
	// also lets the service handler return immediately.
	go func() {
		runtime.WindowUnminimise(serviceContext)
		runtime.WindowShow(serviceContext)
		runtime.EventsEmit(serviceContext, "service:runScript", slotNumber, selected)
	}()
}

// registerServices wires up the macOS "Run Kaja Script" text service. It is a
// no-op on other platforms.
func registerServices(ctx context.Context) {
	serviceContext = ctx
	C.registerKajaService()
}

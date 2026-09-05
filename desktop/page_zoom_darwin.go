//go:build darwin

package main

/*
#cgo LDFLAGS: -framework Cocoa -framework WebKit
#include <stdlib.h>

// Defined in page_zoom_darwin.m.
void kajaSetPageZoom(double zoom);
*/
import "C"

// setPageZoom draws the window's contents at the given multiple of their own size, the
// way a browser's own zoom does.
func setPageZoom(zoom float64) {
	C.kajaSetPageZoom(C.double(zoom))
}

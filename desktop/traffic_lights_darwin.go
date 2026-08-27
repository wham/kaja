//go:build darwin && !ios

package main

/*
#cgo LDFLAGS: -framework Cocoa
#include <stdlib.h>

// Defined in traffic_lights_darwin.m.
void kajaAlignTrafficLights(double bandHeight);
*/
import "C"

// alignTrafficLights centres the macOS window buttons on a band of the given
// height instead of on the title bar AppKit measures against.
func alignTrafficLights(bandHeight int) {
	C.kajaAlignTrafficLights(C.double(bandHeight))
}

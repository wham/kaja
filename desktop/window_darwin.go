//go:build darwin

package main

/*
#cgo LDFLAGS: -framework Cocoa

// Defined in window_darwin.m.
void mainScreenWorkArea(int *width, int *height);
*/
import "C"

// workArea returns the main screen's visible frame in points - the screen
// minus the menu bar and the Dock.
func workArea() (int, int) {
	var width, height C.int
	C.mainScreenWorkArea(&width, &height)
	return int(width), int(height)
}

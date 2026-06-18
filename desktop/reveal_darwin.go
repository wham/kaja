//go:build darwin

package main

/*
#cgo LDFLAGS: -framework Cocoa
#include <stdlib.h>

// Defined in reveal_darwin.m.
void revealPathInFinder(char *path);
*/
import "C"

import "unsafe"

// revealInFinder opens the given directory in Finder. Uses NSWorkspace so it
// works inside the App Sandbox, where launching a subprocess would be blocked.
func revealInFinder(path string) {
	cpath := C.CString(path)
	defer C.free(unsafe.Pointer(cpath))
	C.revealPathInFinder(cpath)
}

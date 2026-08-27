//go:build darwin && !ios

package main

/*
#cgo LDFLAGS: -framework Cocoa
#include <stdlib.h>

// Defined in reveal_darwin.m.
void revealPathInFinder(char *path);
void selectPathInFinder(char *path);
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

// revealFileInFinder opens the given file's directory in Finder with the file
// selected.
func revealFileInFinder(path string) {
	cpath := C.CString(path)
	defer C.free(unsafe.Pointer(cpath))
	C.selectPathInFinder(cpath)
}

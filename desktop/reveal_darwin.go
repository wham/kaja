//go:build darwin

package main

/*
#cgo LDFLAGS: -framework Cocoa
#include <stdlib.h>

// Defined in reveal_darwin.m.
void openFolderInFinderNative(char *path);
void selectInFinderNative(char *path);
*/
import "C"

import "unsafe"

// openFolderInFinder opens the given directory in Finder. Only a directory kaja has
// access to: NSWorkspace reads properties off the URL to open it, and outside the
// container that read is refused and the open fails silently. So this is for the
// workspace's own folders and nothing else.
func openFolderInFinder(path string) {
	cpath := C.CString(path)
	defer C.free(unsafe.Pointer(cpath))
	C.openFolderInFinderNative(cpath)
}

// selectInFinder reveals the given path in the folder holding it, with the path
// itself selected. Finder does the reveal on kaja's behalf, so this is not gated by
// the sandbox and works for a path kaja has no access to at all.
func selectInFinder(path string) {
	cpath := C.CString(path)
	defer C.free(unsafe.Pointer(cpath))
	C.selectInFinderNative(cpath)
}

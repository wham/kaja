package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Foundation

#import <Foundation/Foundation.h>
#include <stdlib.h>

static const char* sandboxTempDir() {
    @autoreleasepool {
        return strdup([NSTemporaryDirectory() UTF8String]);
    }
}
*/
import "C"
import "unsafe"

// SandboxTempDir returns NSTemporaryDirectory(), which resolves to the
// sandbox-scoped temp directory under App Sandbox.
func SandboxTempDir() string {
	cStr := C.sandboxTempDir()
	defer C.free(unsafe.Pointer(cStr))
	return C.GoString(cStr)
}

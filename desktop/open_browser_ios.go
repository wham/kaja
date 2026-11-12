//go:build ios

package main

/*
#cgo LDFLAGS: -framework UIKit -framework AuthenticationServices
#include <stdlib.h>
void kajaBeginSignIn(const char *url);
void kajaEndSignIn(void);
*/
import "C"

import (
	"net/url"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Wails' Browser.OpenURL spawns `open`, which a phone hasn't got and its sandbox
// wouldn't run; UIKit is what hands a URL to Safari.
//
// A sign-in that comes back to the loopback listener is the exception: Safari
// leaves Kaja in the background, iOS suspends it, and the redirect waits on a
// listener that can't answer. An authentication session is presented over Kaja,
// which keeps it in the foreground until the window says the sign-in settled.
func (a *App) openInBrowser(link string) error {
	if !returnsToLoopback(link) {
		application.IOS.OpenURL(link)
		return nil
	}
	target := C.CString(link)
	defer C.free(unsafe.Pointer(target))
	C.kajaBeginSignIn(target)
	return nil
}

func (a *App) closeSignIn() {
	C.kajaEndSignIn()
}

func returnsToLoopback(link string) bool {
	parsed, err := url.Parse(link)
	if err != nil {
		return false
	}
	redirect, err := url.Parse(parsed.Query().Get("redirect_uri"))
	return err == nil && redirect.Scheme == "http" && redirect.Hostname() == "127.0.0.1"
}

//go:build ios

package main

/*
#cgo LDFLAGS: -framework UIKit
*/
import "C"

import "sync"

var (
	urlMu      sync.Mutex
	urlHandler func(string)
	earlyURLs  []string
)

// A cold launch hands over its URL as soon as the launch is delivered, which is
// before main has an App to give it to.
//
//export kajaOpenURL
func kajaOpenURL(url *C.char) {
	link := C.GoString(url)
	urlMu.Lock()
	handler := urlHandler
	if handler == nil {
		earlyURLs = append(earlyURLs, link)
	}
	urlMu.Unlock()
	if handler != nil {
		go handler(link)
	}
}

func onOpenURL(handler func(string)) {
	urlMu.Lock()
	urlHandler = handler
	early := earlyURLs
	earlyURLs = nil
	urlMu.Unlock()
	for _, link := range early {
		handler(link)
	}
}

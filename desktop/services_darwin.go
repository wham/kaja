//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa

#import <Cocoa/Cocoa.h>

// Implemented in Go and called back when macOS delivers selected text to our service.
extern void goServiceRunScript(char *text);

// KajaServiceProvider receives the "Run Kaja Script" Services invocation. The
// method name matches the NSMessage key in Info.plist, so the full selector is
// runScript:userData:error:.
@interface KajaServiceProvider : NSObject
- (void)runScript:(NSPasteboard *)pboard userData:(NSString *)userData error:(NSString **)error;
@end

@implementation KajaServiceProvider
- (void)runScript:(NSPasteboard *)pboard userData:(NSString *)userData error:(NSString **)error {
    @autoreleasepool {
        NSString *text = [pboard stringForType:NSPasteboardTypeString];
        if (text == nil) {
            if (error) *error = @"No text was selected.";
            return;
        }
        // goServiceRunScript copies the string synchronously, so the autorelease
        // pool may reclaim it afterwards.
        goServiceRunScript((char *)[text UTF8String]);
    }
}
@end

// Held for the lifetime of the process; the provider must outlive registration.
static KajaServiceProvider *kajaServiceProvider = nil;

static void registerKajaService(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (kajaServiceProvider == nil) {
            kajaServiceProvider = [[KajaServiceProvider alloc] init];
        }
        [NSApp setServicesProvider:kajaServiceProvider];
        NSUpdateDynamicServices();
    });
}
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
func goServiceRunScript(text *C.char) {
	if serviceContext == nil {
		return
	}
	selected := C.GoString(text)
	// Bring the app to the front so the user sees the script run, then hand the
	// selected text to the UI to run against the pinned script.
	runtime.WindowUnminimise(serviceContext)
	runtime.WindowShow(serviceContext)
	runtime.EventsEmit(serviceContext, "service:runScript", selected)
}

// registerServices wires up the macOS "Run Kaja Script" text service. It is a
// no-op on other platforms.
func registerServices(ctx context.Context) {
	serviceContext = ctx
	C.registerKajaService()
}

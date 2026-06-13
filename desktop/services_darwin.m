#import <Cocoa/Cocoa.h>

// Implemented in Go (services_darwin.go) and called back when macOS delivers
// selected text to our service. slot is the 1-based slot number identifying
// which "Run Kaja Script N" menu item was invoked.
extern void goServiceRunScript(char *slot, char *text);

// KajaServiceProvider receives the "Run Kaja Script N" Services invocations. The
// method name matches the NSMessage key in Info.plist, so the full selector is
// runScript:userData:error:. All three slots share this selector and are
// distinguished by the NSUserData ("1", "2", "3") set per entry in Info.plist.
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
        // goServiceRunScript copies the strings synchronously, so the autorelease
        // pool may reclaim them afterwards.
        NSString *slot = userData ? userData : @"1";
        goServiceRunScript((char *)[slot UTF8String], (char *)[text UTF8String]);
    }
}
@end

// Held for the lifetime of the process; the provider must outlive registration.
static KajaServiceProvider *kajaServiceProvider = nil;

void registerKajaService(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (kajaServiceProvider == nil) {
            kajaServiceProvider = [[KajaServiceProvider alloc] init];
        }
        [NSApp setServicesProvider:kajaServiceProvider];
        NSUpdateDynamicServices();
    });
}

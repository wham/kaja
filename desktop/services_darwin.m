#import <Cocoa/Cocoa.h>

// Implemented in Go (services_darwin.go) and called back when macOS delivers
// selected text to our service.
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

void registerKajaService(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (kajaServiceProvider == nil) {
            kajaServiceProvider = [[KajaServiceProvider alloc] init];
        }
        [NSApp setServicesProvider:kajaServiceProvider];
        NSUpdateDynamicServices();
    });
}

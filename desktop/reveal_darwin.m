#import <Cocoa/Cocoa.h>

// Opens the given directory in Finder. Called from Go (reveal_darwin.go).
void openFolderInFinderNative(char *path) {
    @autoreleasepool {
        NSString *p = [NSString stringWithUTF8String:path];
        if (p == nil) {
            return;
        }
        NSURL *url = [NSURL fileURLWithPath:p isDirectory:YES];
        dispatch_async(dispatch_get_main_queue(), ^{
            [[NSWorkspace sharedWorkspace] openURL:url];
        });
    }
}

// Reveals the given path in the folder holding it, with the path itself selected.
// Called from Go (reveal_darwin.go). The main queue is not just AppKit's usual rule:
// off the main thread this call builds an NSWindow of its own and crashes.
void selectInFinderNative(char *path) {
    @autoreleasepool {
        NSString *p = [NSString stringWithUTF8String:path];
        if (p == nil) {
            return;
        }
        // A folder is revealed here as often as a file. The flag only decides the
        // trailing slash; Finder resolves and selects the item either way.
        NSURL *url = [NSURL fileURLWithPath:p isDirectory:NO];
        dispatch_async(dispatch_get_main_queue(), ^{
            [[NSWorkspace sharedWorkspace] activateFileViewerSelectingURLs:@[ url ]];
        });
    }
}

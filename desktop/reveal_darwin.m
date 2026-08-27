//go:build darwin && !ios

#import <Cocoa/Cocoa.h>

// Opens the given directory in Finder. Called from Go (reveal_darwin.go).
void revealPathInFinder(char *path) {
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

// Opens the given file's directory in Finder with the file selected. Called
// from Go (reveal_darwin.go).
void selectPathInFinder(char *path) {
    @autoreleasepool {
        NSString *p = [NSString stringWithUTF8String:path];
        if (p == nil) {
            return;
        }
        NSURL *url = [NSURL fileURLWithPath:p isDirectory:NO];
        dispatch_async(dispatch_get_main_queue(), ^{
            [[NSWorkspace sharedWorkspace] activateFileViewerSelectingURLs:@[ url ]];
        });
    }
}

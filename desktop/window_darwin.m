#import <Cocoa/Cocoa.h>

// Reports the main screen's visible frame (the screen minus the menu bar and
// the Dock) in points. Called from Go (window_darwin.go). Reports zeroes when
// no screen is available, which leaves the default window size untouched.
void mainScreenWorkArea(int *width, int *height) {
    @autoreleasepool {
        NSScreen *screen = [NSScreen mainScreen];
        if (screen == nil) {
            *width = 0;
            *height = 0;
            return;
        }
        NSRect visible = [screen visibleFrame];
        *width = (int)visible.size.width;
        *height = (int)visible.size.height;
    }
}

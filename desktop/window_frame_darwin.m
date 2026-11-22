//go:build darwin && !ios

#import <Cocoa/Cocoa.h>

void kajaRememberWindowFrame(void *window) {
    NSWindow *nsWindow = (__bridge NSWindow *)window;
    static NSString *const name = @"KajaMainWindow";
    if (![nsWindow.frameAutosaveName isEqualToString:name]) {
        [nsWindow setFrameUsingName:name];
        [nsWindow setFrameAutosaveName:name];
    }
}

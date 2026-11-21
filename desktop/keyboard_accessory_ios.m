//go:build ios

#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

// WebKit puts its form bar (previous, next, done) over the keyboard for anything
// focused, and the editor brings its own bar for the same spot. WKWebView offers no
// way to turn it off: the bar is the inputAccessoryView of WKContentView, the
// private view that takes the keyboard, so that is what answers nil here.
static UIView *kajaNoAccessory(id self, SEL _cmd) {
    return nil;
}

__attribute__((constructor)) static void kajaRemoveFormBar(void) {
    Class contentView = NSClassFromString(@"WKContentView");
    // Replaced on the class itself, since the method found by lookup may be UIResponder's.
    if (contentView) class_replaceMethod(contentView, @selector(inputAccessoryView), (IMP)kajaNoAccessory, "@@:");
}

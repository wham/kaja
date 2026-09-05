#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

// The window's zoom is the webview's own page zoom, which is the one every browser's
// ⌘+ sets: the page is laid out in the same CSS pixels and simply gets fewer of them,
// so a rect, a media query and a popover's anchor go on agreeing with each other. CSS
// `zoom` would scale what is drawn without moving what a popover is anchored to, and
// Wails offers only `magnification` — the pinch-zoom that scales the rendered page
// without reflowing it and refuses to go below 1.
//
// WKWebView.pageZoom is public API (macOS 11), and the view is found by walking the
// window rather than asked for, since Wails keeps its own. A window with no webview
// under it is left alone.

static WKWebView *kajaFindWebView(NSView *view) {
    if ([view isKindOfClass:[WKWebView class]]) {
        return (WKWebView *)view;
    }
    for (NSView *subview in view.subviews) {
        WKWebView *found = kajaFindWebView(subview);
        if (found != nil) {
            return found;
        }
    }
    return nil;
}

// Sets the page zoom of every window the app has. Called from Go (page_zoom_darwin.go).
void kajaSetPageZoom(double zoom) {
    dispatch_async(dispatch_get_main_queue(), ^{
        for (NSWindow *window in [NSApp windows]) {
            WKWebView *webView = kajaFindWebView(window.contentView);
            if (webView != nil) {
                webView.pageZoom = zoom;
            }
        }
    });
}

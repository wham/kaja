//go:build ios

#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

@interface WailsViewController : UIViewController
@property (nonatomic, strong) WKWebView *webView;
@property (nonatomic, strong) UITabBar *tabBar;
@end

// Wails lays the webview out inside the safe area, which leaves the window's own
// colour as a band under the status bar and over the home indicator in whichever
// theme the page is in. The page pads for the insets itself (viewport-fit=cover),
// so the webview takes the whole screen. Swizzled rather than overridden in a
// category, since a category replacing a method the class defines is undefined
// about which one runs.
static void (*wailsLayoutSubviews)(id, SEL);

static void kajaLayoutSubviews(WailsViewController *self, SEL _cmd) {
    wailsLayoutSubviews(self, _cmd);
    if (self.tabBar && !self.tabBar.isHidden) return;
    self.webView.frame = self.view.bounds;
}

@implementation WailsViewController (KajaEdgeToEdge)
+ (void)load {
    Method method = class_getInstanceMethod(self, @selector(viewDidLayoutSubviews));
    wailsLayoutSubviews = (void (*)(id, SEL))method_setImplementation(method, (IMP)kajaLayoutSubviews);
}
@end

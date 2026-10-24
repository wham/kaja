//go:build ios

#import <UIKit/UIKit.h>

extern void kajaOpenURL(char *url);

@interface WailsAppDelegate : UIResponder <UIApplicationDelegate>
@end

// Wails' delegate implements no openURL, so iOS launches Kaja for a kaja:// link
// and hands the link to nobody. The archive is linked with -force_load, which is
// what keeps this category from being dropped with nothing referencing it.
@implementation WailsAppDelegate (KajaLinks)
- (BOOL)application:(UIApplication *)application openURL:(NSURL *)url options:(NSDictionary<UIApplicationOpenURLOptionsKey, id> *)options {
    kajaOpenURL((char *)[[url absoluteString] UTF8String]);
    return YES;
}
@end

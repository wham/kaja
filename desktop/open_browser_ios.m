//go:build ios

#import <UIKit/UIKit.h>
#import <AuthenticationServices/AuthenticationServices.h>

@interface KajaSignInAnchor : NSObject <ASWebAuthenticationPresentationContextProviding>
@end

@implementation KajaSignInAnchor
- (ASPresentationAnchor)presentationAnchorForWebAuthenticationSession:(ASWebAuthenticationSession *)session {
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if (![scene isKindOfClass:[UIWindowScene class]]) continue;
        for (UIWindow *window in ((UIWindowScene *)scene).windows) {
            if (window.isKeyWindow) return window;
        }
    }
    return UIApplication.sharedApplication.windows.firstObject;
}
@end

static ASWebAuthenticationSession *signInSession;
static KajaSignInAnchor *signInAnchor;

// The redirect is a loopback page rather than a scheme, so nothing ever matches the
// callback scheme and the session ends when the window says so, or when the person
// closes it.
void kajaBeginSignIn(const char *url) {
    NSURL *target = [NSURL URLWithString:[NSString stringWithUTF8String:url]];
    dispatch_async(dispatch_get_main_queue(), ^{
        [signInSession cancel];
        signInSession = [[ASWebAuthenticationSession alloc] initWithURL:target
                                                      callbackURLScheme:@"kaja"
                                                      completionHandler:^(NSURL *callback, NSError *error) {
            signInSession = nil;
        }];
        if (signInAnchor == nil) signInAnchor = [KajaSignInAnchor new];
        signInSession.presentationContextProvider = signInAnchor;
        [signInSession start];
    });
}

void kajaEndSignIn(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        [signInSession cancel];
        signInSession = nil;
    });
}

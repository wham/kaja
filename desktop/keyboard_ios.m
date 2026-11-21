//go:build ios

#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

// cgo compiles this without ARC, and turning ARC on for the package would change
// every other Objective-C file in it, so ownership is spelled out where it is taken.
#if __has_feature(objc_arc)
#define KAJA_AUTORELEASE(x) (x)
#else
#define KAJA_AUTORELEASE(x) [(x) autorelease]
#endif

/*
 * The keyboard for code (ui/src/nativeKeyboard.ts): a bar attached to the system
 * keyboard, and a symbol pad that takes the keyboard's place. WKWebView has no API for
 * either, so both hang off WKContentView, the private view that takes the keyboard:
 * its inputAccessoryView is the bar (and nil, not WebKit's previous/next/done bar,
 * wherever the editor doesn't have the focus) and its inputView is the pad while it
 * is up. The page says what the bar shows over a script message, and a key is a call
 * back into the page.
 */

static UIColor *kajaKeyColor(BOOL function) {
    return [UIColor colorWithDynamicProvider:^UIColor *(UITraitCollection *traits) {
        if (traits.userInterfaceStyle == UIUserInterfaceStyleDark) return [UIColor colorWithWhite:function ? 0.27 : 0.42 alpha:1];
        return function ? [UIColor colorWithRed:0.68 green:0.70 blue:0.74 alpha:1] : UIColor.whiteColor;
    }];
}

@interface KajaKey : UIButton
@property (nonatomic, retain) NSArray *action;
@property (nonatomic) BOOL repeats;
@end

@implementation KajaKey
#if !__has_feature(objc_arc)
- (void)dealloc {
    [_action release];
    [super dealloc];
}
#endif
@end

@interface KajaInputView : UIInputView <UIInputViewAudioFeedback>
@end

@implementation KajaInputView
- (BOOL)enableInputClicksWhenVisible {
    return YES;
}
@end

@interface KajaKeyboard : NSObject <WKScriptMessageHandler>
@property (nonatomic, assign) WKWebView *webView;
@property (nonatomic, assign) UIView *contentView;
@property (nonatomic) BOOL active;
@property (nonatomic) BOOL padShown;
@property (nonatomic, retain) NSDictionary *state;
@property (nonatomic, retain) KajaInputView *accessory;
@property (nonatomic, retain) UIStackView *strip;
@property (nonatomic, retain) KajaKey *toggle;
@property (nonatomic, retain) KajaInputView *pad;
@property (nonatomic, retain) NSTimer *repeat;
@property (nonatomic, assign) KajaKey *held;
@end

@implementation KajaKeyboard

+ (instancetype)shared {
    static KajaKeyboard *keyboard;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ keyboard = [[KajaKeyboard alloc] init]; });
    return keyboard;
}

// The webview is Wails', made during the launch, so it is looked for once the app is up
// rather than handed over.
- (void)attach {
    if (self.webView) return;
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if (![scene isKindOfClass:UIWindowScene.class]) continue;
        for (UIWindow *window in ((UIWindowScene *)scene).windows) {
            WKWebView *found = [self webViewIn:window];
            if (!found) continue;
            self.webView = found;
            [found.configuration.userContentController addScriptMessageHandler:self name:@"kajaKeyboard"];
            return;
        }
    }
}

- (WKWebView *)webViewIn:(UIView *)view {
    if ([view isKindOfClass:WKWebView.class]) return (WKWebView *)view;
    for (UIView *child in view.subviews) {
        WKWebView *found = [self webViewIn:child];
        if (found) return found;
    }
    return nil;
}

- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.body isKindOfClass:NSString.class]) return;
    NSData *data = [(NSString *)message.body dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *state = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (![state isKindOfClass:NSDictionary.class]) return;
    self.state = state;
    BOOL active = [state[@"active"] boolValue];
    if (active != self.active) {
        self.active = active;
        if (!active) self.padShown = NO;
        [self reload];
    }
    if (active) [self rebuildStrip];
}

- (void)reload {
    UIView *contentView = self.contentView;
    if (!contentView) {
        Class contentClass = NSClassFromString(@"WKContentView");
        for (UIView *view in self.webView.scrollView.subviews) {
            if ([view isKindOfClass:contentClass]) contentView = view;
        }
    }
    if (contentView.isFirstResponder) [contentView reloadInputViews];
}

- (void)press:(NSArray *)action {
    if ([action.firstObject isEqual:@"pad"]) {
        self.padShown = !self.padShown;
        [self rebuildStrip];
        [self reload];
        return;
    }
    NSData *data = [NSJSONSerialization dataWithJSONObject:action options:0 error:nil];
    NSString *arguments = KAJA_AUTORELEASE([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]);
    NSString *script = [NSString stringWithFormat:@"window.kajaKeyboard && window.kajaKeyboard.press.apply(null, %@)", arguments];
    [self.webView evaluateJavaScript:script completionHandler:nil];
}

#pragma mark Keys

- (KajaKey *)key:(NSString *)title image:(NSString *)image action:(NSArray *)action function:(BOOL)function {
    UIButtonConfiguration *configuration = [UIButtonConfiguration plainButtonConfiguration];
    configuration.background.backgroundColor = kajaKeyColor(function);
    configuration.background.cornerRadius = 7;
    configuration.cornerStyle = UIButtonConfigurationCornerStyleFixed;
    configuration.baseForegroundColor = UIColor.labelColor;
    configuration.contentInsets = NSDirectionalEdgeInsetsMake(0, 10, 0, 10);
    configuration.imagePadding = 3;
    if (image) {
        configuration.image = [UIImage systemImageNamed:image withConfiguration:[UIImageSymbolConfiguration configurationWithPointSize:15 weight:UIImageSymbolWeightMedium]];
    }
    if (title) {
        BOOL code = image == nil && ![action.firstObject isEqual:@"pad"];
        UIFont *font = code ? [UIFont monospacedSystemFontOfSize:18 weight:UIFontWeightRegular] : [UIFont systemFontOfSize:15 weight:UIFontWeightMedium];
        configuration.attributedTitle = KAJA_AUTORELEASE([[NSAttributedString alloc] initWithString:title attributes:@{NSFontAttributeName : font}]);
    }
    KajaKey *key = [KajaKey buttonWithConfiguration:configuration primaryAction:nil];
    key.action = action;
    key.layer.shadowColor = UIColor.blackColor.CGColor;
    key.layer.shadowOffset = CGSizeMake(0, 1);
    key.layer.shadowRadius = 0;
    key.layer.shadowOpacity = 0.3;
    [key addTarget:self action:@selector(keyDown:) forControlEvents:UIControlEventTouchDown];
    [key addTarget:self action:@selector(keyUp:) forControlEvents:UIControlEventTouchUpInside];
    [key addTarget:self action:@selector(keyEnd:) forControlEvents:UIControlEventTouchUpOutside | UIControlEventTouchCancel | UIControlEventTouchDragExit];
    return key;
}

- (void)keyDown:(KajaKey *)key {
    [UIDevice.currentDevice playInputClick];
    if (!key.repeats) return;
    [self stopRepeat];
    [self press:key.action];
    self.held = key;
    self.repeat = [NSTimer scheduledTimerWithTimeInterval:0.4 target:self selector:@selector(startRepeat) userInfo:nil repeats:NO];
}

- (void)startRepeat {
    self.repeat = [NSTimer scheduledTimerWithTimeInterval:0.06 target:self selector:@selector(repeatPress) userInfo:nil repeats:YES];
}

- (void)repeatPress {
    if (self.held) [self press:self.held.action];
}

- (void)stopRepeat {
    [self.repeat invalidate];
    self.repeat = nil;
    self.held = nil;
}

- (void)keyUp:(KajaKey *)key {
    [self stopRepeat];
    if (!key.repeats) [self press:key.action];
}

- (void)keyEnd:(KajaKey *)key {
    [self stopRepeat];
}

#pragma mark The bar

- (KajaInputView *)accessoryView {
    if (self.accessory) return self.accessory;
    KajaInputView *bar = KAJA_AUTORELEASE([[KajaInputView alloc] initWithFrame:CGRectMake(0, 0, 320, 48) inputViewStyle:UIInputViewStyleKeyboard]);
    bar.autoresizingMask = UIViewAutoresizingFlexibleWidth;

    UIScrollView *scroll = KAJA_AUTORELEASE([[UIScrollView alloc] init]);
    scroll.showsHorizontalScrollIndicator = NO;
    scroll.translatesAutoresizingMaskIntoConstraints = NO;
    [bar addSubview:scroll];

    UIStackView *strip = KAJA_AUTORELEASE([[UIStackView alloc] init]);
    strip.axis = UILayoutConstraintAxisHorizontal;
    strip.spacing = 6;
    strip.alignment = UIStackViewAlignmentCenter;
    strip.translatesAutoresizingMaskIntoConstraints = NO;
    [scroll addSubview:strip];

    KajaKey *toggle = [self key:@"{ }" image:nil action:@[ @"pad" ] function:YES];
    toggle.translatesAutoresizingMaskIntoConstraints = NO;
    [bar addSubview:toggle];

    [NSLayoutConstraint activateConstraints:@[
        [scroll.leadingAnchor constraintEqualToAnchor:bar.leadingAnchor],
        [scroll.topAnchor constraintEqualToAnchor:bar.topAnchor],
        [scroll.bottomAnchor constraintEqualToAnchor:bar.bottomAnchor],
        [scroll.trailingAnchor constraintEqualToAnchor:toggle.leadingAnchor constant:-6],
        [toggle.trailingAnchor constraintEqualToAnchor:bar.trailingAnchor constant:-6],
        [toggle.centerYAnchor constraintEqualToAnchor:bar.centerYAnchor],
        [toggle.heightAnchor constraintEqualToConstant:38],
        [toggle.widthAnchor constraintGreaterThanOrEqualToConstant:52],
        [strip.leadingAnchor constraintEqualToAnchor:scroll.contentLayoutGuide.leadingAnchor constant:6],
        [strip.trailingAnchor constraintEqualToAnchor:scroll.contentLayoutGuide.trailingAnchor],
        [strip.topAnchor constraintEqualToAnchor:scroll.contentLayoutGuide.topAnchor],
        [strip.bottomAnchor constraintEqualToAnchor:scroll.contentLayoutGuide.bottomAnchor],
        [strip.heightAnchor constraintEqualToAnchor:scroll.frameLayoutGuide.heightAnchor],
    ]];

    self.accessory = bar;
    self.strip = strip;
    self.toggle = toggle;
    [self rebuildStrip];
    return bar;
}

- (void)add:(UIView *)view {
    [self.strip addArrangedSubview:view];
    [view.heightAnchor constraintEqualToConstant:38].active = YES;
    [view.widthAnchor constraintGreaterThanOrEqualToConstant:38].active = YES;
}

- (void)rebuildStrip {
    if (!self.strip) return;
    for (UIView *view in self.strip.arrangedSubviews) [view removeFromSuperview];
    NSDictionary *state = self.state;
    NSArray *completions = [state[@"completions"] isKindOfClass:NSArray.class] ? state[@"completions"] : @[];
    if (completions.count > 0) {
        [completions enumerateObjectsUsingBlock:^(id label, NSUInteger index, BOOL *stop) {
            if ([label isKindOfClass:NSString.class]) [self add:[self key:label image:nil action:@[ @"complete", @(index) ] function:NO]];
        }];
    } else {
        if ([state[@"fields"] integerValue] > 0) {
            KajaKey *previous = [self key:nil image:@"chevron.left" action:@[ @"prev" ] function:YES];
            previous.enabled = [state[@"canPrev"] boolValue];
            [self add:previous];
            KajaKey *next = [self key:@"Next" image:@"chevron.right" action:@[ @"next" ] function:YES];
            UIButtonConfiguration *configuration = next.configuration;
            configuration.imagePlacement = NSDirectionalRectEdgeTrailing;
            next.configuration = configuration;
            next.enabled = [state[@"canNext"] boolValue];
            [self add:next];
        }
        if (!self.padShown) {
            for (NSString *symbol in @[ @"{", @"}", @"(", @")", @"\"", @":", @",", @".", @"=>" ]) {
                [self add:[self key:symbol image:nil action:@[ @"type", symbol ] function:NO]];
            }
        }
    }
    UIButtonConfiguration *configuration = self.toggle.configuration;
    NSString *title = self.padShown ? @"abc" : @"{ }";
    configuration.attributedTitle = KAJA_AUTORELEASE([[NSAttributedString alloc] initWithString:title attributes:@{NSFontAttributeName : [UIFont systemFontOfSize:15 weight:UIFontWeightMedium]}]);
    self.toggle.configuration = configuration;
}

#pragma mark The pad

- (KajaInputView *)padView {
    if (self.pad) return self.pad;
    KajaInputView *pad = KAJA_AUTORELEASE([[KajaInputView alloc] initWithFrame:CGRectMake(0, 0, 320, 270) inputViewStyle:UIInputViewStyleKeyboard]);
    pad.autoresizingMask = UIViewAutoresizingFlexibleWidth;

    UIStackView *rows = KAJA_AUTORELEASE([[UIStackView alloc] init]);
    rows.axis = UILayoutConstraintAxisVertical;
    rows.spacing = 9;
    rows.distribution = UIStackViewDistributionFillEqually;
    rows.translatesAutoresizingMaskIntoConstraints = NO;
    [pad addSubview:rows];
    [NSLayoutConstraint activateConstraints:@[
        [rows.leadingAnchor constraintEqualToAnchor:pad.leadingAnchor constant:6],
        [rows.trailingAnchor constraintEqualToAnchor:pad.trailingAnchor constant:-6],
        [rows.topAnchor constraintEqualToAnchor:pad.topAnchor constant:8],
        [rows.bottomAnchor constraintEqualToAnchor:pad.safeAreaLayoutGuide.bottomAnchor constant:-6],
    ]];

    NSArray *symbols = @[
        @[ @"{", @"}", @"(", @")", @"[", @"]" ],
        @[ @"\"", @"'", @"`", @":", @";", @"," ],
        @[ @".", @"=>", @"=", @"!", @"?", @"$" ],
        @[ @"&&", @"||", @"<", @">", @"+", @"-" ],
    ];
    for (NSArray *line in symbols) {
        UIStackView *row = [self padRow];
        for (NSString *symbol in line) [row addArrangedSubview:[self key:symbol image:nil action:@[ @"type", symbol ] function:NO]];
        [rows addArrangedSubview:row];
    }
    UIStackView *row = [self padRow];
    NSArray *functions = @[
        @[ @"arrow.right.to.line", @"indent", @NO ], @[ @"arrow.left", @"left", @YES ], @[ @"arrow.right", @"right", @YES ],
        @[ @"arrow.uturn.backward", @"undo", @YES ], @[ @"delete.backward", @"backspace", @YES ],
    ];
    for (NSArray *function in functions) {
        KajaKey *key = [self key:nil image:function[0] action:@[ function[1] ] function:YES];
        key.repeats = [function[2] boolValue];
        [row addArrangedSubview:key];
    }
    [row addArrangedSubview:[self key:@"abc" image:nil action:@[ @"pad" ] function:YES]];
    [rows addArrangedSubview:row];

    self.pad = pad;
    return pad;
}

- (UIStackView *)padRow {
    UIStackView *row = KAJA_AUTORELEASE([[UIStackView alloc] init]);
    row.axis = UILayoutConstraintAxisHorizontal;
    row.spacing = 6;
    row.distribution = UIStackViewDistributionFillEqually;
    return row;
}

@end

#pragma mark WKContentView

static IMP wkInputView;

static UIView *kajaInputAccessoryView(UIView *self, SEL _cmd) {
    KajaKeyboard *keyboard = KajaKeyboard.shared;
    keyboard.contentView = self;
    [keyboard attach];
    return keyboard.active ? [keyboard accessoryView] : nil;
}

static UIView *kajaInputView(UIView *self, SEL _cmd) {
    KajaKeyboard *keyboard = KajaKeyboard.shared;
    if (keyboard.active && keyboard.padShown) return [keyboard padView];
    return wkInputView ? ((UIView * (*)(id, SEL)) wkInputView)(self, _cmd) : nil;
}

__attribute__((constructor)) static void kajaInstallKeyboard(void) {
    Class contentView = NSClassFromString(@"WKContentView");
    if (!contentView) return;
    // Replaced on the class itself, since the method found by lookup may be UIResponder's.
    class_replaceMethod(contentView, @selector(inputAccessoryView), (IMP)kajaInputAccessoryView, "@@:");
    IMP replaced = class_replaceMethod(contentView, @selector(inputView), (IMP)kajaInputView, "@@:");
    wkInputView = replaced ?: class_getMethodImplementation(class_getSuperclass(contentView), @selector(inputView));
    [NSNotificationCenter.defaultCenter addObserverForName:UIApplicationDidBecomeActiveNotification
                                                    object:nil
                                                     queue:NSOperationQueue.mainQueue
                                                usingBlock:^(NSNotification *note) { [KajaKeyboard.shared attach]; }];
}

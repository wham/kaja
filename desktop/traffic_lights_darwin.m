#import <Cocoa/Cocoa.h>

// AppKit centres the three window buttons on the 28pt title bar, which is 6pt
// above the centre of the 40px band the sidebar header and the command row
// share — so the window's top-left corner reads as two staggered baselines.
// Neither AppKit nor Wails has a position to set (AppKit only offers the whole
// title bar, and wails/v2 mac.TitleBar is six booleans), so we do what every
// app that wants this does: make the title bar container as tall as the band
// and put the buttons in the middle of it. Nothing here is private — the
// buttons are asked for by name and only their frames are touched — so it
// holds in the sandboxed App Store build.
//
// A taller container does not move anything on its own: AppKit lays the
// buttons out a fixed distance below the container's top, so the container is
// only what keeps them from being clipped and the move is the buttons' own.
// AppKit re-runs that layout on its own schedule — the window is first shown,
// the title changes, the appearance changes, fullscreen ends — and puts them
// back where it wants them, so every view between the window and the buttons
// is watched and the geometry is applied again whenever one of them moves.
// Applying is written to be a no-op once it is already right, and is deferred
// to the end of the run loop turn so the last word belongs to us rather than
// to the layout pass that is still running.

@interface KajaTrafficLights : NSObject {
    CGFloat _bandHeight;
    NSWindow *_window;   // The app's own window; dropped when it closes.
    NSArray *_observed;  // The views being watched, retained for as long as they are.
    BOOL _scheduled;
}
- (instancetype)initWithBandHeight:(CGFloat)bandHeight;
@end

static KajaTrafficLights *trafficLights = nil;

// Centres the macOS window buttons on a band of the given height. Called from
// Go (traffic_lights_darwin.go); the first call is the one that counts.
void kajaAlignTrafficLights(double bandHeight) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (trafficLights != nil) {
            return;
        }
        trafficLights = [[KajaTrafficLights alloc] initWithBandHeight:bandHeight];
    });
}

@implementation KajaTrafficLights

- (instancetype)initWithBandHeight:(CGFloat)bandHeight {
    self = [super init];
    if (self == nil) {
        return nil;
    }
    _bandHeight = bandHeight;

    NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
    [center addObserver:self selector:@selector(windowBecameMain:) name:NSWindowDidBecomeMainNotification object:nil];
    [center addObserver:self selector:@selector(windowChanged:) name:NSWindowDidResizeNotification object:nil];
    [center addObserver:self selector:@selector(windowChanged:) name:NSWindowDidExitFullScreenNotification object:nil];
    [center addObserver:self selector:@selector(windowWillClose:) name:NSWindowWillCloseNotification object:nil];

    // Wails creates the window before it calls the Go startup hook, so it is
    // normally already there; becoming main is the fallback for when it isn't.
    if (![self adopt:[NSApp mainWindow]]) {
        for (NSWindow *window in [NSApp windows]) {
            if ([self adopt:window]) {
                break;
            }
        }
    }
    return self;
}

// Takes the app's own window, which is the one titled window that isn't a
// panel. Everything else AppKit hands us — alerts, file dialogs, menus — has no
// buttons of ours to move.
- (BOOL)adopt:(NSWindow *)window {
    if (_window != nil || window == nil) {
        return NO;
    }
    if ([window isKindOfClass:[NSPanel class]]) {
        return NO;
    }
    if ((window.styleMask & NSWindowStyleMaskTitled) == 0) {
        return NO;
    }
    if ([window standardWindowButton:NSWindowCloseButton] == nil) {
        return NO;
    }
    _window = window;
    [self apply];
    return YES;
}

- (void)windowBecameMain:(NSNotification *)notification {
    if (_window == nil) {
        [self adopt:notification.object];
        return;
    }
    [self windowChanged:notification];
}

- (void)windowChanged:(NSNotification *)notification {
    if (notification.object == _window) {
        [self scheduleApply];
    }
}

// The window is not retained, so let go of it before it is gone.
- (void)windowWillClose:(NSNotification *)notification {
    if (notification.object != _window) {
        return;
    }
    _window = nil;
    [self observe:[NSArray array]];
}

- (void)viewFrameChanged:(NSNotification *)notification {
    [self scheduleApply];
}

// AppKit moves the buttons from inside its own layout pass, and a frame set
// while that is running is one it may still overwrite. Waiting for the turn to
// end also folds a pass that moved all four views into a single apply.
- (void)scheduleApply {
    if (_scheduled || _window == nil) {
        return;
    }
    _scheduled = YES;
    dispatch_async(dispatch_get_main_queue(), ^{
        [self apply];
    });
}

- (void)apply {
    _scheduled = NO;
    if (_window == nil) {
        return;
    }
    // In fullscreen the buttons belong to the menu bar overlay, which is
    // AppKit's to lay out. Exiting it brings us back here.
    if ((_window.styleMask & NSWindowStyleMaskFullScreen) != 0) {
        return;
    }

    NSButton *close = [_window standardWindowButton:NSWindowCloseButton];
    NSButton *miniaturize = [_window standardWindowButton:NSWindowMiniaturizeButton];
    NSButton *zoom = [_window standardWindowButton:NSWindowZoomButton];
    if (close == nil || miniaturize == nil || zoom == nil) {
        return;
    }
    NSView *titleBar = close.superview;
    NSView *container = titleBar.superview;
    if (container == nil) {
        return;
    }
    CGFloat buttonHeight = NSHeight(close.frame);
    if (buttonHeight <= 0 || _bandHeight < buttonHeight) {
        return;
    }

    [self observe:@[ container, titleBar, close, miniaturize, zoom ]];

    NSRect wanted = container.frame;
    wanted.size.height = _bandHeight;
    wanted.origin.y = NSHeight(_window.frame) - _bandHeight;
    if (!NSEqualRects(wanted, container.frame)) {
        [container setFrame:wanted];
    }

    // The container is now the band, so the middle of the band is the middle of
    // the container — in the coordinates of whatever view holds the buttons.
    NSPoint middle = [titleBar convertPoint:NSMakePoint(0.0, _bandHeight / 2.0) fromView:container];
    CGFloat y = floor(middle.y - buttonHeight / 2.0);
    for (NSButton *button in @[ close, miniaturize, zoom ]) {
        if (NSMinY(button.frame) != y) {
            [button setFrameOrigin:NSMakePoint(NSMinX(button.frame), y)];
        }
    }
}

// The buttons can be removed and re-added, taking their container with them, so
// the observation follows whichever views are holding them now. They are
// retained for as long as they are observed, since the notification centre does
// not hold them and an observation of a released view is a dangling one.
- (void)observe:(NSArray *)views {
    if ([_observed isEqualToArray:views]) {
        return;
    }
    NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
    for (NSView *view in _observed) {
        [center removeObserver:self name:NSViewFrameDidChangeNotification object:view];
    }
    [_observed release];
    _observed = [views retain];
    for (NSView *view in _observed) {
        [view setPostsFrameChangedNotifications:YES];
        [center addObserver:self selector:@selector(viewFrameChanged:) name:NSViewFrameDidChangeNotification object:view];
    }
}

@end

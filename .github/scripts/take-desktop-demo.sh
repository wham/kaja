#!/bin/bash
set -e

# Takes demo screenshots of the actual Kaja desktop app on macOS.
# Uses screencapture for window captures and cliclick for UI interaction.

DEMO_DIR=".github/demo"
WORKSPACE_DIR="$PWD/workspace"

mkdir -p "$DEMO_DIR"

# --- Helpers ---

get_window_id() {
    python3 -c "
import Quartz
windows = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID)
for w in windows:
    if w.get('kCGWindowOwnerName') == 'Kaja':
        print(int(w['kCGWindowNumber']))
        break
" 2>/dev/null
}

get_window_bounds() {
    python3 -c "
import Quartz
windows = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID)
for w in windows:
    if w.get('kCGWindowOwnerName') == 'Kaja':
        b = w['kCGWindowBounds']
        print(f'{int(b[\"X\"])} {int(b[\"Y\"])} {int(b[\"Width\"])} {int(b[\"Height\"])}')
        break
" 2>/dev/null
}

screenshot() {
    local name="$1"
    local wid
    wid=$(get_window_id || true)
    if [ -n "$wid" ]; then
        screencapture -l"$wid" -o -x "$DEMO_DIR/$name"
        echo "  ✓ $name"
    else
        echo "  ✗ Window not found for $name"
        return 1
    fi
}

# Click at a position relative to the Kaja window
click_at() {
    local rel_x=$1
    local rel_y=$2
    local abs_x=$((WIN_X + rel_x))
    local abs_y=$((WIN_Y + rel_y))
    cliclick c:"$abs_x","$abs_y"
    echo "  Click at window-relative ($rel_x, $rel_y)"
}

# --- Setup ---

echo "Setting up desktop config..."
mkdir -p ~/.kaja
cat > ~/.kaja/kaja.json << EOF
{
  "projects": [
    {
      "name": "grpc-quirks",
      "protocol": "RPC_PROTOCOL_GRPC",
      "url": "dns:kaja.tools:443",
      "protoDir": "$WORKSPACE_DIR/quirks",
      "headers": {
        "X-Yolo": "kaja123",
        "Authorization": "Bear brown"
      }
    },
    {
      "name": "twirp-quirks",
      "protocol": "RPC_PROTOCOL_TWIRP",
      "url": "https://kaja.tools/twirp-quirks",
      "protoDir": "$WORKSPACE_DIR/quirks",
      "headers": {
        "X-Yolo": "kaja123",
        "Authorization": "Bear brown"
      }
    }
  ],
  "system": {
    "canUpdateConfiguration": true
  }
}
EOF

# --- Launch app ---

APP_PATH="$PWD/desktop/build/bin/Kaja.app"

# Remove quarantine attribute — unsigned apps are blocked by Gatekeeper in CI
echo "Removing quarantine attribute..."
xattr -rd com.apple.quarantine "$APP_PATH" 2>/dev/null || true

echo "Launching Kaja.app..."
open "$APP_PATH"

echo "Waiting for Kaja process..."
for i in $(seq 1 15); do
    if pgrep -x Kaja > /dev/null 2>&1; then
        echo "  ✓ Kaja process running (pid: $(pgrep -x Kaja))"
        break
    fi
    sleep 1
done

if ! pgrep -x Kaja > /dev/null 2>&1; then
    echo "  ✗ Kaja process not found — app may have crashed"
    echo "  Checking crash logs..."
    log show --predicate 'process == "Kaja"' --last 30s 2>/dev/null | tail -20 || true
    echo "  Trying direct launch for error output..."
    "$APP_PATH/Contents/MacOS/Kaja" &
    sleep 5
    if ! pgrep -x Kaja > /dev/null 2>&1; then
        echo "  ✗ Direct launch also failed"
        exit 1
    fi
fi

echo "Waiting for Kaja window..."
WINDOW_ID=""
for i in $(seq 1 30); do
    WINDOW_ID=$(get_window_id || true)
    if [ -n "$WINDOW_ID" ]; then
        echo "  ✓ Window found (id: $WINDOW_ID)"
        break
    fi
    # Diagnostic: list all windows to see what's there
    if [ "$i" = "10" ] || [ "$i" = "20" ]; then
        echo "  (listing all windows for diagnostics)"
        python3 -c "
import Quartz
windows = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionAll, Quartz.kCGNullWindowID)
for w in windows:
    owner = w.get('kCGWindowOwnerName', '?')
    name = w.get('kCGWindowName', '')
    layer = w.get('kCGWindowLayer', '')
    wid = w.get('kCGWindowNumber', '')
    if owner == 'Kaja' or (name and 'Kaja' in str(name)):
        print(f'  → id={wid} owner={owner} name={name} layer={layer}')
" 2>/dev/null || true
    fi
    sleep 1
done

if [ -z "$WINDOW_ID" ]; then
    echo "  ✗ Kaja window not found after 30s"
    echo "  All windows:"
    python3 -c "
import Quartz
windows = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionAll, Quartz.kCGNullWindowID)
for w in windows:
    owner = w.get('kCGWindowOwnerName', '?')
    wid = w.get('kCGWindowNumber', '')
    layer = w.get('kCGWindowLayer', '')
    b = w.get('kCGWindowBounds', {})
    print(f'  id={wid} owner={owner} layer={layer} bounds={b}')
" 2>/dev/null | head -30 || true
    exit 1
fi

read -r WIN_X WIN_Y WIN_W WIN_H < <(get_window_bounds)
echo "  Window bounds: origin=($WIN_X,$WIN_Y) size=${WIN_W}x${WIN_H}"

osascript -e 'tell application "Kaja" to activate'
sleep 1

# Wait for projects to compile
echo "Waiting for projects to compile..."
sleep 30

# --- Screenshots ---

# 1. Home
echo "Taking home screenshot..."
screenshot "home.png"

# 2. Click a method in the sidebar tree
# Sidebar tree items start ~60px from top; each item ~32px tall
# With 2 projects and their services expanded, "Types" is roughly at y≈250
echo "Clicking method in sidebar..."
click_at 150 250
sleep 3

# Click Run button — primary button in the top-right of the content pane
echo "Clicking Run button..."
click_at $((WIN_W - 80)) 55
sleep 5

# 3. Call
echo "Taking call screenshot..."
screenshot "call.png"

# 4. Click Compiler button in sidebar header (CPU icon, right side of header)
echo "Clicking Compiler button..."
click_at 235 18
sleep 5

# Click first compiler item to expand logs
echo "Expanding first compiler item..."
click_at $((WIN_W / 2)) 180
sleep 3

# 5. Compiler
echo "Taking compiler screenshot..."
screenshot "compiler.png"

echo "Desktop demo complete!"

# Quit the app
osascript -e 'tell application "Kaja" to quit' 2>/dev/null || true

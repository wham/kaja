package main

// Startup window size, matching what VS Code (and its forks, e.g. Cursor) open
// a workspace window with on macOS: 1440x900, centered on the display, and
// resizable down to 400x270.
const (
	windowWidth     = 1440
	windowHeight    = 900
	windowMinWidth  = 400
	windowMinHeight = 270
)

// windowSize is the size the window opens at, shrunk to fit the display's work
// area so it never opens larger than the screen it is centered on.
func windowSize() (int, int) {
	areaWidth, areaHeight := workArea()
	return fitWindowSize(areaWidth, areaHeight)
}

// fitWindowSize clamps the default size to the given work area. A zero or
// unusably small area means the work area is unknown, so the default is used.
func fitWindowSize(areaWidth, areaHeight int) (int, int) {
	width, height := windowWidth, windowHeight
	if areaWidth >= windowMinWidth && areaWidth < width {
		width = areaWidth
	}
	if areaHeight >= windowMinHeight && areaHeight < height {
		height = areaHeight
	}
	return width, height
}

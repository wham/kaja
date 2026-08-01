package main

import "testing"

func TestFitWindowSize(t *testing.T) {
	tests := []struct {
		name                  string
		areaWidth, areaHeight int
		wantWidth, wantHeight int
	}{
		{"unknown work area", 0, 0, windowWidth, windowHeight},
		{"large display", 3008, 1662, windowWidth, windowHeight},
		{"exactly the default", windowWidth, windowHeight, windowWidth, windowHeight},
		{"laptop display", 1440, 831, windowWidth, 831},
		{"small display", 1280, 723, 1280, 723},
		{"implausibly small area", 100, 100, windowWidth, windowHeight},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			width, height := fitWindowSize(test.areaWidth, test.areaHeight)
			if width != test.wantWidth || height != test.wantHeight {
				t.Fatalf("fitWindowSize(%d, %d) = %dx%d, want %dx%d",
					test.areaWidth, test.areaHeight, width, height, test.wantWidth, test.wantHeight)
			}
		})
	}
}

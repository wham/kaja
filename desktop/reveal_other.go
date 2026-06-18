//go:build !darwin

package main

import (
	"os/exec"
	"runtime"
)

// revealInFinder opens the given directory in the system file browser.
func revealInFinder(path string) {
	if runtime.GOOS == "windows" {
		_ = exec.Command("explorer", path).Start()
		return
	}
	_ = exec.Command("xdg-open", path).Start()
}

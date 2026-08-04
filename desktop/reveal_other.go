//go:build !darwin

package main

import (
	"os/exec"
	"path/filepath"
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

// revealFileInFinder opens the given file's directory in the system file
// browser with the file selected, where the browser supports it.
func revealFileInFinder(path string) {
	if runtime.GOOS == "windows" {
		_ = exec.Command("explorer", "/select,"+path).Start()
		return
	}
	_ = exec.Command("xdg-open", filepath.Dir(path)).Start()
}

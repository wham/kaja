//go:build !darwin

package main

import (
	"os/exec"
	"path/filepath"
	"runtime"
)

// openFolderInFinder opens the given directory in the system file browser.
func openFolderInFinder(path string) {
	if runtime.GOOS == "windows" {
		_ = exec.Command("explorer", path).Start()
		return
	}
	_ = exec.Command("xdg-open", path).Start()
}

// selectInFinder opens the folder holding the given path in the system file browser
// with the path selected, where the browser supports it.
func selectInFinder(path string) {
	if runtime.GOOS == "windows" {
		_ = exec.Command("explorer", "/select,"+path).Start()
		return
	}
	_ = exec.Command("xdg-open", filepath.Dir(path)).Start()
}

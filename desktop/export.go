package main

import (
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	wails "github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/wham/kaja/v2/pkg/api"
	"github.com/wham/kaja/v2/pkg/bundle"
)

// The runner an exported app is made of. It is embedded rather than built,
// because a desktop app has no toolchain and needs none: the runner is
// content-independent — the same bytes for every export — so making one is a
// copy with the bundle appended to it.
//
// Which platform it is for is decided when Kaja itself is built, and that is
// the whole of why an exported app runs where this Kaja runs. A build with no
// runner beside it still compiles; the directory holds a .gitkeep so the embed
// has something to match, and the button says what is missing rather than the
// program failing to start.
//
//go:embed all:build/runner
var runnerFS embed.FS

const runnerPath = "build/runner/kaja-run"

// ExportedApp is what was written, and what the person it is handed to will
// need to know about it.
type ExportedApp struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Size int64  `json:"size"`
	// Platform is the one the runner inside it was built for, which is this
	// machine's. It is reported rather than assumed: an exported app is made to
	// be given away, and where it will and won't run is the first thing to know
	// about it.
	Platform string `json:"platform"`
	// Warnings are what the export could not freeze and what it could not
	// resolve — an app that still opens over the network, a variable with
	// nowhere to read a value from where this will run.
	Warnings []string `json:"warnings"`
}

// ExportScriptAsApp freezes a script and everything it calls into one file that
// runs on its own. The name is a script in the workspace's scripts folder.
//
// A cancelled save dialog is not a failure: it returns nothing, and the UI says
// nothing.
func (a *App) ExportScriptAsApp(name string) (*ExportedApp, error) {
	if !hasRunner() {
		return nil, fmt.Errorf("this build of Kaja has no runner in it, so it cannot write an app; build Kaja with scripts/desktop")
	}

	// Where it goes is asked first, so a long export is not spent on a file the
	// dialog is then cancelled out of.
	destination, err := wails.SaveFileDialog(a.ctx, wails.SaveDialogOptions{
		Title:                "Export as app",
		DefaultFilename:      exportedName(name),
		CanCreateDirectories: true,
	})
	if err != nil {
		return nil, err
	}
	if destination == "" {
		return nil, nil
	}

	return writeExportedApp(a.api, name, destination)
}

// writeExportedApp is the export itself, with the dialog left out of it: one
// script, one destination, one file. Everything Wails knows about this feature
// is the line above that asks where the file goes.
func writeExportedApp(service *api.ApiService, name string, destination string) (*ExportedApp, error) {
	runner, err := runnerFS.ReadFile(runnerPath)
	if err != nil {
		return nil, fmt.Errorf("this build of Kaja has no runner in it, so it cannot write an app; build Kaja with scripts/desktop")
	}

	work, err := os.MkdirTemp("", "kaja-export-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(work)

	base := strings.TrimSuffix(filepath.Base(name), filepath.Ext(name))
	exported, err := service.ExportScript(&api.ExportRequest{
		Script: name,
		Out:    filepath.Join(work, base+".kaja"),
	})
	if err != nil {
		return nil, err
	}

	// AppendTo copies a runner and appends the bundle to it, so the runner has to
	// be a file. It is written here rather than kept unpacked: an export is a
	// deliberate act and a few tens of megabytes of temp file is the cheapest
	// part of it.
	staged := filepath.Join(work, "kaja-run")
	if err := os.WriteFile(staged, runner, 0o755); err != nil {
		return nil, err
	}
	if err := bundle.AppendTo(staged, exported.Path, destination); err != nil {
		return nil, err
	}

	written := &ExportedApp{
		Path:     destination,
		Name:     filepath.Base(destination),
		Platform: platformName(),
		Warnings: exported.Warnings,
	}
	if info, err := os.Stat(destination); err == nil {
		written.Size = info.Size()
	}
	return written, nil
}

// hasRunner reports whether this build can write an app at all. A checkout that
// has not built one still compiles — the embed matches the directory's .gitkeep
// — so the question is asked of the file rather than of the build.
func hasRunner() bool {
	_, err := runnerFS.ReadFile(runnerPath)
	return err == nil
}

// exportedName is what the save dialog opens on: the script's name without the
// extension it had as source, plus the one this platform needs to run it.
func exportedName(script string) string {
	return strings.TrimSuffix(filepath.Base(script), filepath.Ext(script)) + appExtension()
}

// RevealExportedApp shows a file the export just wrote. It is the same reveal
// the scripts folder uses, and it is here so the result of an export is one
// click from the Finder rather than a path to go and find.
func (a *App) RevealExportedApp(path string) error {
	revealFileInFinder(path)
	return nil
}

func appExtension() string {
	if runtime.GOOS == "windows" {
		return ".exe"
	}
	return ""
}

// platformName is what to tell somebody about where the exported file runs. The
// architecture is named because the two Macs are not interchangeable and a file
// that will not open says nothing about why.
func platformName() string {
	switch runtime.GOOS {
	case "darwin":
		// The two Macs are the one place where the everyday words are the clear
		// ones, and where being wrong is a file that will not open.
		if runtime.GOARCH == "arm64" {
			return "macOS · Apple silicon"
		}
		return "macOS · Intel"
	case "windows":
		return "Windows · " + runtime.GOARCH
	case "linux":
		return "Linux · " + runtime.GOARCH
	}
	return runtime.GOOS + " · " + runtime.GOARCH
}

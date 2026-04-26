package main

import (
	"flag"
	"io"
	"log/slog"
	"os"
	"path"
	"path/filepath"

	"github.com/wham/kaja/v2/internal/ui"
)

func main() {
	var watch bool
	var outDir string
	var staticSrc string
	flag.BoolVar(&watch, "watch", false, "watch source files and re-bundle main.{js,css}+codicon on every change")
	flag.StringVar(&outDir, "out", "build", "output directory")
	flag.StringVar(&staticSrc, "static", "", "directory to copy alongside the bundle (index.html lifted to root, rest under static/)")
	flag.Parse()

	if watch {
		if err := watchMain(outDir); err != nil {
			os.Exit(1)
		}
	} else {
		if err := build(outDir, staticSrc); err != nil {
			os.Exit(1)
		}
	}
}

// watchMain re-bundles the main entry point on every source change. Monaco
// workers and static files are not watched - they're written by build() and
// don't change between rebuilds.
func watchMain(outDir string) error {
	if err := os.MkdirAll(outDir, os.ModePerm); err != nil {
		slog.Error("Failed to create output directory", "error", err)
		return err
	}
	slog.Info("Watching UI source for changes...", "out", outDir)
	if _, err := ui.WatchForDevelopment(outDir); err != nil {
		slog.Error("Failed to start watcher", "error", err)
		return err
	}
	select {}
}

func build(outputDirectory string, staticSrc string) error {
	slog.Info("Building UI for production...")

	data, err := ui.BuildForProduction()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(outputDirectory, os.ModePerm); err != nil {
		slog.Error("Failed to create output directory", "error", err)
		return err
	}

	outputFile := path.Join(outputDirectory, "main.js")
	if err := os.WriteFile(outputFile, data.MainJs, 0644); err != nil {
		slog.Error("Failed to write output file", "error", err)
		return err
	}

	outputFile = path.Join(outputDirectory, "main.css")
	if err := os.WriteFile(outputFile, data.MainCss, 0644); err != nil {
		slog.Error("Failed to write output file", "error", err)
		return err
	}

	outputFile = path.Join(outputDirectory, data.CodiconTtfName)
	if err := os.WriteFile(outputFile, data.CodiconTtf, 0644); err != nil {
		slog.Error("Failed to write output file", "error", err)
		return err
	}

	for _, worker := range ui.MonacoWorkerNames {
		workerData, err := ui.BuildMonacoWorker(worker)
		if err != nil {
			return err
		}
		outputFile = path.Join(outputDirectory, "monaco."+worker+".worker.js")
		if err := os.WriteFile(outputFile, workerData, 0644); err != nil {
			slog.Error("Failed to write worker file", "error", err)
			return err
		}
		slog.Info("Monaco worker built", "file", outputFile)
	}

	if staticSrc != "" {
		if err := copyStatic(staticSrc, outputDirectory); err != nil {
			slog.Error("Failed to copy static files", "error", err)
			return err
		}
	}

	slog.Info("UI built successfully")

	return nil
}

// copyStatic mirrors the layout produced by the legacy `cp -r server/static
// .../dist && mv dist/static/index.html dist/index.html` step in scripts/desktop:
// index.html lands at outDir/, everything else under outDir/static/.
func copyStatic(srcDir, outDir string) error {
	staticOut := filepath.Join(outDir, "static")
	if err := os.MkdirAll(staticOut, 0755); err != nil {
		return err
	}
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		dst := filepath.Join(staticOut, entry.Name())
		if entry.Name() == "index.html" {
			dst = filepath.Join(outDir, entry.Name())
		}
		if err := copyFile(filepath.Join(srcDir, entry.Name()), dst); err != nil {
			return err
		}
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

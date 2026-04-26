package main

import (
	"flag"
	"log/slog"
	"os"
	"path"

	"github.com/wham/kaja/v2/internal/ui"
)

func main() {
	var watch bool
	var outDir string
	flag.BoolVar(&watch, "watch", false, "watch source files and re-bundle main.{js,css}+codicon on every change")
	flag.StringVar(&outDir, "out", "build", "output directory")
	flag.Parse()

	if watch {
		if err := watchMain(outDir); err != nil {
			os.Exit(1)
		}
	} else {
		if err := build(outDir); err != nil {
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

func build(outputDirectory string) error {
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

	slog.Info("UI built successfully")

	return nil
}

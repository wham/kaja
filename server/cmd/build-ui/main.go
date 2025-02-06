package main

import (
	"log/slog"
	"os"
	"path"

	"github.com/wham/kaja/v2/internal/ui"
)

func main() {
	if err := build(); err != nil {
		os.Exit(1)
	}
}

func build() error {
	slog.Info("Building UI for production...")

	data, err := ui.BuildForProduction()
	if err != nil {
		return err
	}

	outputDirectory := "build"
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

	outputFile = path.Join(outputDirectory, "codicon-37A3DWZT.ttf")
	if err := os.WriteFile(outputFile, data.CodiconTtf, 0644); err != nil {
		slog.Error("Failed to write output file", "error", err)
		return err
	}

	slog.Info("UI built successfully")

	pgt, err := ui.BuildProtocGenTs()
	if err != nil {
		return err
	}

	outputFile = path.Join(outputDirectory, "protoc-gen-ts")
	if err := os.WriteFile(outputFile, pgt, 0644); err != nil {
		slog.Error("Failed to write output file", "error", err)
		return err
	}

	slog.Info("protoc-gen-ts built successfully", "outputFile", outputFile)

	return nil
}

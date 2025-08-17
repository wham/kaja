package ui

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	esbuild "github.com/evanw/esbuild/pkg/api"
)

type UiBundle struct {
	MainJs     []byte
	MainCss    []byte
	CodiconTtf []byte
}

func BuildForDevelopment() *UiBundle {
	result := esbuild.Build(esbuild.BuildOptions{
		EntryPoints: []string{"../ui/src/main.tsx"},
		Bundle:      true,
		Format:      esbuild.FormatESModule,
		Sourcemap:   esbuild.SourceMapInline,
		Outdir:      "build",
		Loader: map[string]esbuild.Loader{
			".ttf": esbuild.LoaderFile,
		},
	})

	bundle, _ := buildResultToUiBundle(result)

	return bundle
}

func BuildForProduction() (*UiBundle, error) {
	result := esbuild.Build(esbuild.BuildOptions{
		EntryPoints:       []string{"../ui/src/main.tsx"},
		Bundle:            true,
		Format:            esbuild.FormatESModule,
		MinifyWhitespace:  true,
		MinifyIdentifiers: true,
		MinifySyntax:      true,
		Outdir:            "build",
		Loader: map[string]esbuild.Loader{
			".ttf": esbuild.LoaderFile,
		},
	})

	return buildResultToUiBundle(result)
}

func buildResultToUiBundle(result esbuild.BuildResult) (*UiBundle, error) {
	if len(result.Errors) > 0 {
		slog.Error("Failed to build the UI", "errors", result.Errors)
		return nil, fmt.Errorf("failed to build the UI")
	}

	bundle := &UiBundle{}

	for _, file := range result.OutputFiles {
		fileName := file.Path[strings.LastIndex(file.Path, "/")+1:]
		switch fileName {
		case "main.js":
			bundle.MainJs = file.Contents
		case "main.css":
			bundle.MainCss = file.Contents
		case "codicon-37A3DWZT.ttf":
			bundle.CodiconTtf = file.Contents
		}
	}

	if bundle.MainJs == nil || bundle.MainCss == nil || bundle.CodiconTtf == nil {
		return nil, fmt.Errorf("failed to find one of the output files")
	}

	return bundle, nil
}

func BuildProtocGenTs() ([]byte, error) {
	result := esbuild.Build(esbuild.BuildOptions{
		EntryPoints: []string{"../ui/node_modules/.bin/protoc-gen-ts"},
		Bundle:      true,
		Format:      esbuild.FormatESModule,
		Platform:    esbuild.PlatformNode,
	})

	if len(result.Errors) > 0 {
		slog.Error("Failed to build protoc-gen-ts", "errors", result.Errors)
		return nil, fmt.Errorf("failed to build protoc-gen-ts")
	}

	return result.OutputFiles[0].Contents, nil
}

var MonacoWorkerNames = []string{"json", "css", "html", "ts", "editor"}

func BuildMonacoWorker(name string) ([]byte, error) {
	path := fmt.Sprintf("language/%s/%s.worker.js", name, name)

	if name == "ts" {
		path = "language/typescript/ts.worker.js"
	}

	if name == "editor" {
		path = "editor/editor.worker.js"
	}

	result := esbuild.Build(esbuild.BuildOptions{
		EntryPoints: []string{fmt.Sprintf("../ui/node_modules/monaco-editor/esm/vs/%s", path)},
		Bundle:      true,
		Format:      esbuild.FormatIIFE,
		Platform:    esbuild.PlatformBrowser,
	})

	if len(result.Errors) > 0 {
		slog.Error("Failed to build monaco worker "+name, "errors", result.Errors)
		return nil, fmt.Errorf("failed to build monaco worker %s", name)
	}

	return result.OutputFiles[0].Contents, nil
}

func BuildStub(projectName string) ([]byte, error) {
	sourcesDir := "./build/sources/" + projectName
	var stubContent strings.Builder
	err := filepath.Walk(sourcesDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			stubContent.WriteString("export * from \"" + strings.Replace(path, "build/sources/"+projectName, "./", 1) + "\";\n")
		}
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to read sources directory when building stub for project %s: %w", projectName, err)
	}

	slog.Debug("Successfully built stub for project %s, length %d", projectName, stubContent.Len())

	result := esbuild.Build(esbuild.BuildOptions{
		Stdin: &esbuild.StdinOptions{
			Contents:   stubContent.String(),
			ResolveDir: sourcesDir,
			Sourcefile: "stub.ts",
		},
		Bundle:   true,
		Format:   esbuild.FormatESModule,
		Packages: esbuild.PackagesExternal,
	})

	if len(result.Errors) > 0 {
		return nil, fmt.Errorf("failed to build stub for project %s: %w", projectName, result.Errors[0])
	}

	first := result.OutputFiles[0]

	return first.Contents, nil
}

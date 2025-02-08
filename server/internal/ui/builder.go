package ui

import (
	"fmt"
	"log/slog"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
)

type UiBundle struct {
	MainJs     []byte
	MainCss    []byte
	CodiconTtf []byte
}

func BuildForDevelopment() *UiBundle {
	result := api.Build(api.BuildOptions{
		EntryPoints: []string{"../ui/src/main.tsx"},
		Bundle:      true,
		Format:      api.FormatESModule,
		Sourcemap:   api.SourceMapInline,
		Outdir:      "build",
		Loader: map[string]api.Loader{
			".ttf": api.LoaderFile,
		},
	})

	bundle, _ := buildResultToUiBundle(result)

	return bundle
}

func BuildForProduction() (*UiBundle, error) {
	result := api.Build(api.BuildOptions{
		EntryPoints:       []string{"../ui/src/main.tsx"},
		Bundle:            true,
		Format:            api.FormatESModule,
		MinifyWhitespace:  true,
		MinifyIdentifiers: true,
		MinifySyntax:      true,
		Outdir:            "build",
		Loader: map[string]api.Loader{
			".ttf": api.LoaderFile,
		},
	})

	return buildResultToUiBundle(result)
}

func buildResultToUiBundle(result api.BuildResult) (*UiBundle, error) {
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
	result := api.Build(api.BuildOptions{
		EntryPoints: []string{"../ui/node_modules/.bin/protoc-gen-ts"},
		Bundle:      true,
		Format:      api.FormatESModule,
		Platform:    api.PlatformNode,
	})

	if len(result.Errors) > 0 {
		slog.Error("Failed to build protoc-gen-ts", "errors", result.Errors)
		return nil, fmt.Errorf("failed to build protoc-gen-ts")
	}

	return result.OutputFiles[0].Contents, nil
}

type MonacoWorker struct {
	Name     string
	Contents []byte
}

func BuildMonacoWorkers() ([]MonacoWorker, error) {
	names := []string{
		"editor.worker",
	}

	workers := make([]MonacoWorker, len(names))

	for i, name := range names {
		result := api.Build(api.BuildOptions{
			EntryPoints: []string{fmt.Sprintf("../ui/node_modules/monaco-editor/esm/vs/editor/%s.js", name)},
			Bundle:      true,
			Format:      api.FormatIIFE,
			Platform:    api.PlatformBrowser,
		})

		if len(result.Errors) > 0 {
			slog.Error("Failed to build monaco worker", "errors", result.Errors)
			return nil, fmt.Errorf("failed to build monaco worker")
		}

		workers[i] = MonacoWorker{
			Name:     name,
			Contents: result.OutputFiles[0].Contents,
		}
	}

	return workers, nil
}

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

func BuildForDevelopment() []byte {
	result := api.Build(api.BuildOptions{
		EntryPoints: []string{"../ui/src/main.tsx"},
		Bundle:      true,
		Format:      api.FormatESModule,
		Sourcemap:   api.SourceMapInline,
	})

	if len(result.Errors) > 0 {
		slog.Error("Failed to build the UI", "errors", result.Errors)
		return nil
	}

	return result.OutputFiles[0].Contents
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

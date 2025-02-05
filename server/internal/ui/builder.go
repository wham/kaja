package ui

import (
	"fmt"
	"log/slog"

	"github.com/evanw/esbuild/pkg/api"
)

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

func BuildForProduction() ([]byte, error) {
	result := api.Build(api.BuildOptions{
		EntryPoints:       []string{"../ui/src/main.tsx"},
		Bundle:            true,
		Format:            api.FormatESModule,
		MinifyWhitespace:  true,
		MinifyIdentifiers: true,
		MinifySyntax:      true,
	})

	if len(result.Errors) > 0 {
		slog.Error("Failed to build the UI", "errors", result.Errors)
		return nil, fmt.Errorf("failed to build the UI")
	}

	return result.OutputFiles[0].Contents, nil
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

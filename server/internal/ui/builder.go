package ui

import (
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

func BuildForProduction() []byte {
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
		return nil
	}

	return result.OutputFiles[0].Contents
}

package ui

import (
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	esbuild "github.com/evanw/esbuild/pkg/api"
)

// tailwindPlugin compiles ui/src/tailwind.css into ui/build/tailwind.css with the
// Tailwind CLI before every esbuild run. esbuild's Go API can't run Tailwind's
// PostCSS plugin, so we shell out; main.tsx imports the generated file, folding it
// into main.css. bun (and thus the Tailwind binary) is already a build-time dependency.
var tailwindPlugin = esbuild.Plugin{
	Name: "tailwindcss",
	Setup: func(build esbuild.PluginBuild) {
		build.OnStart(func() (esbuild.OnStartResult, error) {
			// Run the Tailwind CLI through bun rather than the node-shebang bin shim:
			// bun is the one JS runtime present everywhere the UI is built (local dev,
			// the mac desktop CI runner, and the node-less Docker builder stage).
			cmd := exec.Command(
				"bun",
				"./node_modules/@tailwindcss/cli/dist/index.mjs",
				"-i", "src/tailwind.css",
				"-o", "build/tailwind.css",
				"--minify",
			)
			// builder.go always runs with the server/ directory as CWD, so ui is ../ui
			// (matching the "../ui/src/main.tsx" entry points below).
			cmd.Dir = "../ui"
			if out, err := cmd.CombinedOutput(); err != nil {
				return esbuild.OnStartResult{
					Errors: []esbuild.Message{{Text: "tailwindcss build failed: " + string(out)}},
				}, nil
			}
			return esbuild.OnStartResult{}, nil
		})
	},
}

type UiBundle struct {
	MainJs         []byte
	MainCss        []byte
	CodiconTtf     []byte
	CodiconTtfName string
}

var MonacoWorkerNames = []string{"ts", "editor", "json"}

func BuildForDevelopment() *UiBundle {
	result := esbuild.Build(esbuild.BuildOptions{
		EntryPoints: []string{"../ui/src/main.tsx"},
		Bundle:      true,
		Format:      esbuild.FormatESModule,
		Sourcemap:   esbuild.SourceMapInline,
		Outdir:      "build",
		Plugins:     []esbuild.Plugin{tailwindPlugin},
		Loader: map[string]esbuild.Loader{
			".ttf": esbuild.LoaderFile,
		},
	})

	bundle, _ := buildResultToUiBundle(result)

	return bundle
}

// WatchForDevelopment starts an esbuild watcher that re-bundles the UI into outDir
// whenever a source file changes. Used by scripts/desktop with `wails dev -assetdir`
// so Wails' built-in fsnotify watcher picks up the changes and reloads the window.
// Blocks forever; the returned context is for cancellation by callers.
func WatchForDevelopment(outDir string) (esbuild.BuildContext, error) {
	ctx, ctxErr := esbuild.Context(esbuild.BuildOptions{
		EntryPoints: []string{"../ui/src/main.tsx"},
		Bundle:      true,
		Format:      esbuild.FormatESModule,
		Sourcemap:   esbuild.SourceMapInline,
		Outdir:      outDir,
		Write:       true,
		Plugins:     []esbuild.Plugin{tailwindPlugin},
		Loader: map[string]esbuild.Loader{
			".ttf": esbuild.LoaderFile,
		},
	})
	if ctxErr != nil {
		return nil, fmt.Errorf("failed to create esbuild context: %s", ctxErr.Error())
	}
	if err := ctx.Watch(esbuild.WatchOptions{}); err != nil {
		ctx.Dispose()
		return nil, err
	}
	return ctx, nil
}

func BuildForProduction() (*UiBundle, error) {
	result := esbuild.Build(esbuild.BuildOptions{
		EntryPoints:       []string{"../ui/src/main.tsx"},
		Bundle:            true,
		Format:            esbuild.FormatESModule,
		MinifyWhitespace:  true,
		MinifyIdentifiers: true,
		MinifySyntax:      true,
		// Preserve function/class names so stack traces captured in the desktop
		// logs (uiLog.ts) stay readable instead of showing mangled identifiers.
		KeepNames: true,
		Outdir:    "build",
		Plugins:   []esbuild.Plugin{tailwindPlugin},
		Loader: map[string]esbuild.Loader{
			".ttf": esbuild.LoaderFile,
		},
	})

	return buildResultToUiBundle(result)
}

func buildResultToUiBundle(result esbuild.BuildResult) (*UiBundle, error) {
	if len(result.Errors) > 0 {
		for _, e := range result.Errors {
			if e.Location != nil {
				slog.Error("ESBuild error", "text", e.Text, "file", e.Location.File, "line", e.Location.Line, "column", e.Location.Column)
			} else {
				slog.Error("ESBuild error", "text", e.Text)
			}
		}
		return nil, fmt.Errorf("failed to build the UI")
	}

	bundle := &UiBundle{}

	for _, file := range result.OutputFiles {
		fileName := file.Path[strings.LastIndex(file.Path, "/")+1:]
		switch {
		case fileName == "main.js":
			bundle.MainJs = file.Contents
		case fileName == "main.css":
			bundle.MainCss = file.Contents
		case strings.HasPrefix(fileName, "codicon-") && strings.HasSuffix(fileName, ".ttf"):
			bundle.CodiconTtf = file.Contents
			bundle.CodiconTtfName = fileName
		}
	}

	if bundle.MainJs == nil || bundle.MainCss == nil || bundle.CodiconTtf == nil {
		return nil, fmt.Errorf("failed to find one of the output files")
	}

	return bundle, nil
}

func BuildStub(sourcesDir string) ([]byte, error) {
	var stubContent strings.Builder
	err := filepath.Walk(sourcesDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			relativePath, _ := filepath.Rel(sourcesDir, path)
			// Use namespace exports to avoid name collisions when multiple packages
			// define the same enum name (e.g., basics.lib.Position and quirks.lib.Position)
			relativePath = filepath.ToSlash(relativePath)
			identifier := strings.TrimSuffix(relativePath, ".ts")
			identifier = strings.ReplaceAll(identifier, "/", "$")
			identifier = strings.ReplaceAll(identifier, ".", "$")
			identifier = strings.ReplaceAll(identifier, "-", "$")
			stubContent.WriteString("export * as " + identifier + " from \"./" + relativePath + "\";\n")
		}
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to read sources directory when building stub: %w", err)
	}

	slog.Debug("Successfully built stub", "sourcesDir", sourcesDir, "length", stubContent.Len())

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
		return nil, fmt.Errorf("failed to build stub: %s", result.Errors[0].Text)
	}

	first := result.OutputFiles[0]

	return first.Contents, nil
}

func BuildMonacoWorker(name string) ([]byte, error) {
	path := "editor/editor.worker.js"
	switch name {
	case "ts":
		path = "language/typescript/ts.worker.js"
	case "json":
		path = "language/json/json.worker.js"
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

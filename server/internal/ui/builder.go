package ui

import (
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	esbuild "github.com/evanw/esbuild/pkg/api"
)

// The generated stylesheet, named from the two directories the build runs in:
// builder.go always has server/ as its CWD, the Tailwind CLI runs in ui/.
const (
	tailwindOut       = "build/tailwind.css"
	tailwindOutFromUi = "../server/" + tailwindOut
)

// tailwindPlugin compiles ui/src/tailwind.css into server/build/tailwind.css with the
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
				"-o", tailwindOutFromUi,
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

// sourceStamp is what the UI sources looked like at a point in time: how many
// files there are and the newest modification time among them. A file added,
// removed or written moves one of the two.
type sourceStamp struct {
	files  int
	newest time.Time
	read   bool
}

func (s sourceStamp) matches(other sourceStamp) bool {
	return s.read && other.read && s.files == other.files && s.newest.Equal(other.newest)
}

func (s *sourceStamp) take(info os.FileInfo) {
	s.files++
	if info.ModTime().After(s.newest) {
		s.newest = info.ModTime()
	}
}

// stampUiSources covers everything the bundle is built from that a developer
// edits: the sources themselves, and the dependencies they are bundled with.
func stampUiSources() sourceStamp {
	stamp := stampUiDependencies()
	if !stamp.read {
		return stamp
	}

	if err := filepath.Walk("../ui/src", func(_ string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			stamp.take(info)
		}
		return nil
	}); err != nil {
		return sourceStamp{}
	}

	return stamp
}

// stampUiDependencies is the two files that decide what is in node_modules,
// which is all a Monaco worker is built from.
func stampUiDependencies() sourceStamp {
	stamp := sourceStamp{read: true}

	for _, path := range []string{"../ui/package.json", "../ui/bun.lock"} {
		info, err := os.Stat(path)
		if err != nil {
			return sourceStamp{}
		}
		stamp.take(info)
	}

	return stamp
}

type UiBundle struct {
	MainJs         []byte
	MainCss        []byte
	CodiconTtf     []byte
	CodiconTtfName string
}

var MonacoWorkerNames = []string{"ts", "editor", "json"}

// One page load asks for main.css, main.js and the codicon font, which are
// three outputs of one build - so the development server bundles the UI when
// the sources have changed since it last did, rather than once per request.
// That is still "recompiled on page load": an edit is picked up by the first
// request after it, and a reload that follows no edit can only produce the
// bytes already in hand. The esbuild context is kept alive across rebuilds so
// the one after an edit reuses what it parsed for the one before.
var (
	devMu      sync.Mutex
	devCtx     esbuild.BuildContext
	devBundle  *UiBundle
	devSources sourceStamp
)

func BuildForDevelopment() *UiBundle {
	devMu.Lock()
	defer devMu.Unlock()

	sources := stampUiSources()
	if devBundle != nil && devSources.matches(sources) {
		return devBundle
	}

	if devCtx == nil {
		ctx, ctxErr := esbuild.Context(esbuild.BuildOptions{
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
		if ctxErr != nil {
			slog.Error("Failed to create esbuild context", "error", ctxErr.Error())
			return devBundle
		}
		devCtx = ctx
	}

	bundle, err := buildResultToUiBundle(devCtx.Rebuild())
	if err != nil {
		// Keep serving the last bundle that built, and leave the stamp behind
		// so the next request tries again: a syntax error mid-edit belongs in
		// the editor, not in a window that failed to load the editor.
		return devBundle
	}
	devBundle = bundle
	devSources = sources

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

// A worker is asked for on every page load and is bundled from node_modules
// alone, so it is built again when the dependencies change and not when the UI
// does - no edit to ui/src can reach one.
var (
	workerMu      sync.Mutex
	workerBuilt   = map[string][]byte{}
	workerSources sourceStamp
)

func BuildMonacoWorker(name string) ([]byte, error) {
	path := "editor/editor.worker.js"
	switch name {
	case "ts":
		path = "language/typescript/ts.worker.js"
	case "json":
		path = "language/json/json.worker.js"
	}

	workerMu.Lock()
	defer workerMu.Unlock()

	sources := stampUiDependencies()
	if !workerSources.matches(sources) {
		workerBuilt = map[string][]byte{}
		workerSources = sources
	}
	if built, ok := workerBuilt[name]; ok {
		return built, nil
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

	workerBuilt[name] = result.OutputFiles[0].Contents

	return result.OutputFiles[0].Contents, nil
}

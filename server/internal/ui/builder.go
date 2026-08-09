package ui

import (
	"crypto/sha256"
	"fmt"
	"hash"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

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

// sourceStamp is a digest of every source file's path and contents. It is what
// they hold rather than when they were written, because an edit can arrive with
// an old modification time - a checkout, a `cp -p`, an unpacked archive - and
// one that isn't seen is one served stale. The sources are 1.5 MB, which reads
// in single-digit milliseconds, so there is nothing to buy by asking a cheaper
// question.
type sourceStamp struct {
	digest string
}

func (s sourceStamp) matches(other sourceStamp) bool {
	return s.digest != "" && s.digest == other.digest
}

// stampUiSources covers everything the bundle is built from that a developer
// edits: the sources themselves, and the dependencies they are bundled with.
func stampUiSources() sourceStamp {
	digest := sha256.New()

	if !hashDependencies(digest) {
		return sourceStamp{}
	}

	// Walk visits in lexical order, so the same tree always hashes the same.
	if err := filepath.Walk("../ui/src", func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		return hashFile(digest, path)
	}); err != nil {
		return sourceStamp{}
	}

	return sourceStamp{digest: string(digest.Sum(nil))}
}

// stampUiDependencies is the two files that decide what is in node_modules,
// which is all a Monaco worker is built from.
func stampUiDependencies() sourceStamp {
	digest := sha256.New()

	if !hashDependencies(digest) {
		return sourceStamp{}
	}

	return sourceStamp{digest: string(digest.Sum(nil))}
}

func hashDependencies(digest hash.Hash) bool {
	for _, path := range []string{"../ui/package.json", "../ui/bun.lock"} {
		if err := hashFile(digest, path); err != nil {
			return false
		}
	}
	return true
}

// The path goes in with the contents, so that renaming a file is a change and
// two files swapping contents is one too.
func hashFile(digest hash.Hash, path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	if _, err := io.WriteString(digest, path+"\x00"); err != nil {
		return err
	}
	_, err = io.Copy(digest, file)

	return err
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

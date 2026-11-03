package ui

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"hash"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
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
	MainJs   []byte
	MainCss  []byte
	WorkerJs []byte
}

// The editor's TypeScript runs in a worker, which is a second entry point of the
// same build: it is the UI's own code, so it moves when ui/src does.
var entryPoints = []string{"../ui/src/main.tsx", "../ui/src/typescript.worker.ts"}

// tsLibs is the standard library the worker's TypeScript checks against, which a
// browser has no file system to read it from. It is the closure of what
// lib.esnext.full.d.ts references, read out of the JavaScript TypeScript the
// worker bundles (the repo's own TypeScript 7 has no lib a browser can load).
var tsLibs = esbuild.Plugin{
	Name: "typescript-libs",
	Setup: func(build esbuild.PluginBuild) {
		build.OnResolve(esbuild.OnResolveOptions{Filter: `^kaja:typescript-libs$`}, func(args esbuild.OnResolveArgs) (esbuild.OnResolveResult, error) {
			return esbuild.OnResolveResult{Path: args.Path, Namespace: "typescript-libs"}, nil
		})
		build.OnLoad(esbuild.OnLoadOptions{Filter: `.*`, Namespace: "typescript-libs"}, func(args esbuild.OnLoadArgs) (esbuild.OnLoadResult, error) {
			const dir = "../ui/node_modules/typescript-js/lib/"
			libs := map[string]string{}
			var watched []string
			var walk func(name string) error
			walk = func(name string) error {
				file := "lib." + name + ".d.ts"
				if _, ok := libs[file]; ok {
					return nil
				}
				content, err := os.ReadFile(dir + file)
				if err != nil {
					return err
				}
				libs[file] = string(content)
				watched = append(watched, dir+file)
				for _, match := range libReference.FindAllStringSubmatch(string(content), -1) {
					if err := walk(strings.ToLower(match[1])); err != nil {
						return err
					}
				}
				return nil
			}
			if err := walk("esnext.full"); err != nil {
				return esbuild.OnLoadResult{}, err
			}
			encoded, err := json.Marshal(libs)
			if err != nil {
				return esbuild.OnLoadResult{}, err
			}
			contents := "export default " + string(encoded) + ";"
			return esbuild.OnLoadResult{Contents: &contents, Loader: esbuild.LoaderJS, WatchFiles: watched}, nil
		})
	},
}

var libReference = regexp.MustCompile(`/// <reference lib="([^"]+)" />`)

// One page load asks for main.css, main.js and the worker, which are three
// outputs of one build - so the development server bundles the UI when the
// sources have changed since it last did, rather than once per request. That
// is still "recompiled on page load": an edit is picked up by the first request
// after it, and a reload that follows no edit can only produce the bytes
// already in hand. The esbuild context is kept alive across rebuilds so the one
// after an edit reuses what it parsed for the one before.
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
			EntryPoints: entryPoints,
			Bundle:      true,
			Format:      esbuild.FormatESModule,
			Sourcemap:   esbuild.SourceMapInline,
			Outdir:      "build",
			Plugins:     []esbuild.Plugin{tailwindPlugin, tsLibs},
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
// whenever a source file changes. Listed as a background process in
// desktop/build/config.yml, so a development build - which serves this directory
// off disk - shows the change on the next window reload.
// Blocks forever; the returned context is for cancellation by callers.
func WatchForDevelopment(outDir string) (esbuild.BuildContext, error) {
	ctx, ctxErr := esbuild.Context(esbuild.BuildOptions{
		EntryPoints: entryPoints,
		Bundle:      true,
		Format:      esbuild.FormatESModule,
		Sourcemap:   esbuild.SourceMapInline,
		Outdir:      outDir,
		Write:       true,
		Plugins:     []esbuild.Plugin{tailwindPlugin, tsLibs},
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
		EntryPoints:       entryPoints,
		Bundle:            true,
		Format:            esbuild.FormatESModule,
		MinifyWhitespace:  true,
		MinifyIdentifiers: true,
		MinifySyntax:      true,
		// Preserve function/class names so stack traces captured in the desktop
		// logs (uiLog.ts) stay readable instead of showing mangled identifiers.
		KeepNames: true,
		Outdir:    "build",
		Plugins:   []esbuild.Plugin{tailwindPlugin, tsLibs},
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
		switch file.Path[strings.LastIndex(file.Path, "/")+1:] {
		case "main.js":
			bundle.MainJs = file.Contents
		case "main.css":
			bundle.MainCss = file.Contents
		case "typescript.worker.js":
			bundle.WorkerJs = file.Contents
		}
	}

	if bundle.MainJs == nil || bundle.MainCss == nil || bundle.WorkerJs == nil {
		return nil, fmt.Errorf("failed to find one of the output files")
	}

	return bundle, nil
}

// Command kaja-export turns a script into something that runs on its own.
//
// It writes a .kaja bundle — the script, the client stubs its imports resolve
// to, and the frozen proto surface of every app it calls — which `kaja-run`
// runs. Given -runner it also writes the single file that is both: a copy of
// the runner with the bundle appended to it.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/wham/kaja/v2/pkg/api"
	"github.com/wham/kaja/v2/pkg/bundle"
)

func main() {
	configurationPath := flag.String("workspace", "../workspace/kaja.json", "the kaja.json the script belongs to")
	script := flag.String("script", "", "the script to export, by name in the workspace's scripts folder or by path")
	out := flag.String("out", "", "where to write the bundle (default <script>.kaja)")
	runner := flag.String("runner", "", "a kaja-run binary to append the bundle to, producing one self-contained file")
	verbose := flag.Bool("verbose", false, "print what each app did while it was being frozen")
	flag.Parse()

	if *script == "" {
		fmt.Fprintln(os.Stderr, "usage: kaja-export -script <name> [-workspace kaja.json] [-out app.kaja] [-runner kaja-run]")
		os.Exit(2)
	}

	service := api.NewApiService(*configurationPath, false, "", "", nil)
	result, err := service.ExportScript(&api.ExportRequest{Script: *script, Out: *out})
	if err != nil {
		fmt.Fprintln(os.Stderr, "export failed:", err)
		os.Exit(1)
	}

	if *verbose {
		for _, log := range result.Logs {
			fmt.Fprintln(os.Stderr, log.Message)
		}
	}

	fmt.Printf("%s — %s, %d app(s), %s\n", result.Path, result.Manifest.Title, len(result.Manifest.Apps), size(result.Size))
	for _, warning := range result.Warnings {
		fmt.Println("  " + warning)
	}

	if *runner == "" {
		return
	}

	// The one file an exported app is. Nothing is compiled to make it: the runner
	// is prebuilt for its platform and the bundle is data appended to a copy of
	// it, which is the same operation whatever the target.
	app := filepath.Join(filepath.Dir(result.Path), result.Manifest.Name)
	if err := bundle.AppendTo(*runner, result.Path, app); err != nil {
		fmt.Fprintln(os.Stderr, "cannot write the app:", err)
		os.Exit(1)
	}
	info, err := os.Stat(app)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("%s — one file, %s\n", app, size(info.Size()))
}

func size(bytes int64) string {
	switch {
	case bytes >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(bytes)/(1<<20))
	case bytes >= 1<<10:
		return fmt.Sprintf("%.0f KB", float64(bytes)/(1<<10))
	default:
		return fmt.Sprintf("%d B", bytes)
	}
}

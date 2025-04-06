//go:build dev

package main

import "github.com/wham/kaja/v2/cmd/desktop"

import "embed"

//go:embed all:static
var TestFS embed.FS

func main() {
	desktop.Main(TestFS)
}
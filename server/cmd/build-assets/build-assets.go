package main

import (
	"fmt"
	"os"

	"github.com/evanw/esbuild/pkg/api"
)

func main() {
	cwd, err := os.Getwd()
	if err != nil { 
			fmt.Printf("Failed to get current working directory: %s\n", err)   
			return
	}
	fmt.Printf("CWD: %s\n", cwd)
	
	result := api.Build(api.BuildOptions{
			EntryPoints: []string{"../client/src/main.tsx"},
			Bundle:      true,
			Format:    api.FormatESModule,
			Outfile: "web/assets/kaja-twirp.js",
			Write: true,
	})

	if (len(result.Errors) > 0) {
		fmt.Printf("Build failed: %s\n", result.Errors[0].Text)
		return
	}

	fmt.Printf("Build succeeded. Wrote %d files.\n", len(result.OutputFiles))
	for _, file := range result.OutputFiles {
		fmt.Printf("Wrote %s\n", file.Path)
	}

	result = api.Build(api.BuildOptions{
		EntryPoints: []string{"../client/node_modules/.bin/protoc-gen-ts"},
		Bundle:      true,
		Format:    api.FormatESModule,
		Platform: api.PlatformNode,
		Outfile: "../bin/protoc-gen-ts",
		Write: true,
	})

	if (len(result.Errors) > 0) {
		fmt.Printf("Build failed: %s\n", result.Errors[0].Text)
		return
	}

	fmt.Printf("Build succeeded. Wrote %d files.\n", len(result.OutputFiles))
	for _, file := range result.OutputFiles {
		fmt.Printf("Wrote %s\n", file.Path)
	}
}
//go:build !darwin

package main

import "os"

func SandboxTempDir() string {
	return os.TempDir()
}

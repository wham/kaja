//go:build !darwin || ios

package main

import "github.com/wailsapp/wails/v3/pkg/application"

func rememberWindowFrame(window *application.WebviewWindow) {}

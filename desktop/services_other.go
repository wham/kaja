//go:build !darwin

package main

import "context"

// registerServices is a no-op outside macOS; the text service relies on the
// macOS Services framework.
func registerServices(ctx context.Context) {}

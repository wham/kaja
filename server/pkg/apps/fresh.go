package apps

import "context"

type freshKey struct{}

// WithFresh marks a context as the Recompile gesture, which is the one way past what
// an app keeps of its upstream between opens: the app reads the upstream again and
// replaces what it kept.
func WithFresh(ctx context.Context) context.Context {
	return context.WithValue(ctx, freshKey{}, true)
}

// Fresh reports whether ctx asks for the upstream to be read again.
func Fresh(ctx context.Context) bool {
	fresh, _ := ctx.Value(freshKey{}).(bool)
	return fresh
}

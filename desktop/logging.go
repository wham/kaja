package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// setupLogging routes slog to <kajaHome>/logs/kaja.log so server-side logs land
// in the same shareable file as the UI logs (see LogFromUI). Without this, slog
// only writes to stderr, which a Finder-launched .app discards — so failures
// like the MCP server not starting were invisible. Output is also mirrored to
// stderr for the dev build.
func setupLogging(kajaDir string) {
	dir := filepath.Join(kajaDir, "logs")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return
	}
	f, err := os.OpenFile(filepath.Join(dir, "kaja.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	w := io.MultiWriter(os.Stderr, f)
	slog.SetDefault(slog.New(newServerLogHandler(w, slog.LevelInfo)))
}

// serverLogHandler writes single-line records as "<time> [server] [LEVEL] msg
// key=value ...", matching the format LogFromUI uses for "[ui]" lines.
type serverLogHandler struct {
	mu    *sync.Mutex
	w     io.Writer
	level slog.Level
	attrs []slog.Attr
}

func newServerLogHandler(w io.Writer, level slog.Level) *serverLogHandler {
	return &serverLogHandler{mu: &sync.Mutex{}, w: w, level: level}
}

func (h *serverLogHandler) Enabled(_ context.Context, l slog.Level) bool {
	return l >= h.level
}

func (h *serverLogHandler) Handle(_ context.Context, r slog.Record) error {
	var b strings.Builder
	fmt.Fprintf(&b, "%s [server] [%s] %s", r.Time.Format(time.RFC3339), r.Level.String(), r.Message)
	for _, a := range h.attrs {
		fmt.Fprintf(&b, " %s=%v", a.Key, a.Value.Any())
	}
	r.Attrs(func(a slog.Attr) bool {
		fmt.Fprintf(&b, " %s=%v", a.Key, a.Value.Any())
		return true
	})
	b.WriteByte('\n')
	h.mu.Lock()
	defer h.mu.Unlock()
	_, err := io.WriteString(h.w, b.String())
	return err
}

func (h *serverLogHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	nh := *h
	nh.attrs = append(append([]slog.Attr{}, h.attrs...), attrs...)
	return &nh
}

func (h *serverLogHandler) WithGroup(_ string) slog.Handler {
	return h
}

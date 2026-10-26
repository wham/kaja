package api

import (
	"context"
	"log/slog"

	"github.com/wham/kaja/v2/internal/tempdir"
)

// reopen opens an app a call names but this process has no instance for, from the
// workspace the call was resolved against: a process restarted under an open window
// has none, and the window does not know to compile again.
func (s *ApiService) reopen(ctx context.Context, name string, snapshot *workspaceSnapshot) bool {
	entry, ok := snapshot.apps[name]
	if !ok || entry.appType == "" {
		return false
	}
	// One at a time, so a run of concurrent calls opens the app once.
	s.reopenMu.Lock()
	defer s.reopenMu.Unlock()
	if s.apps.IsOpen(name) {
		return true
	}

	key := compileKey(entry.appType, entry.parameters)
	if compiled, ok := s.compiled.get(key); ok {
		s.apps.Register(name, compiled.opened.Instance)
		return true
	}
	protoDir := ""
	if needsSourcesDir(entry.appType, entry.parameters) {
		dir, err := tempdir.NewSourcesDir()
		if err != nil {
			slog.Warn("Reopening app", "app", name, "error", err)
			return false
		}
		protoDir = dir
	}
	parameters := make(map[string]string, len(entry.parameters))
	for key, value := range entry.parameters {
		parameters[key] = value
	}
	// Not the call's own cancellation: the calls waiting behind this one are opening
	// the same app.
	opened, err := s.apps.Instantiate(context.WithoutCancel(ctx), entry.appType, parameters, protoDir, func(string) {})
	if err != nil {
		slog.Warn("Reopening app", "app", name, "error", err)
		return false
	}
	s.apps.Register(name, opened.Instance)
	slog.Info("Reopened app a call named", "app", name)
	return true
}

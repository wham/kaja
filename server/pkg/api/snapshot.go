package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"

	"github.com/wham/kaja/v2/pkg/apps/rpc"
	pkggrpc "github.com/wham/kaja/v2/pkg/grpc"
	"google.golang.org/protobuf/proto"
)

// workspaceSnapshot is kaja.json as the service last read it, with everything a call
// derives from it already derived: the variables resolved against the store and the
// environment, and each app's parameters expanded and path-resolved. Every call used
// to parse the file and ask the keychain again; the snapshot is built once and dropped
// when something that could change it happens - the file moving on disk, a write, a
// stored value, another workspace being opened.
type workspaceSnapshot struct {
	workspace *Workspace
	logs      []*Log
	raw       []byte
	dir       string
	resolver  *Resolver
	// generation fingerprints the file's bytes and the variable statuses, so two
	// readings of one state compare equal and a client can tell a change from a
	// repeat.
	generation string
	apps       map[string]*snapshotApp
}

// snapshotApp is one app as the door needs it: its type, its parameters as Open would
// be handed them, and for a forwarded app the credential and transport read off them.
type snapshotApp struct {
	appType    string
	parameters map[string]string
	metadata   map[string]string
	tls        pkggrpc.TLSOptions
}

// snapshot is the current reading of the workspace, built on first use. Building one
// also starts the file watcher, because a snapshot nothing invalidates is a stale one:
// an edit made outside kaja has to be noticed for the next call to read it.
func (s *ApiService) snapshot() *workspaceSnapshot {
	s.snapshotMu.Lock()
	defer s.snapshotMu.Unlock()
	if s.current != nil {
		return s.current
	}
	s.current = buildSnapshot(s.workspaceFilePath(), s.variableStore)
	s.ensureWatcher()
	return s.current
}

// resolved is the snapshot as a request reads it: resolved against the values the
// request brought where it brought any, and the snapshot itself where it didn't.
func (s *ApiService) resolved(ctx context.Context) *workspaceSnapshot {
	snapshot := s.snapshot()
	if values := s.browserValues(ctx); values != nil {
		return snapshot.with(values)
	}
	return snapshot
}

// invalidateSnapshot drops the current reading so the next call reads the file again.
func (s *ApiService) invalidateSnapshot() {
	s.snapshotMu.Lock()
	s.current = nil
	s.snapshotMu.Unlock()
}

func buildSnapshot(workspaceFile string, store VariableStore) *workspaceSnapshot {
	logger := NewLogger()
	logger.debug("Workspace file " + workspaceFile)
	raw, workspace := readWorkspaceFile(workspaceFile, logger)
	normalize(workspace, logger)
	validateApps(workspace, logger)

	snapshot := &workspaceSnapshot{workspace: workspace, logs: logger.logs, raw: raw, dir: workspaceDir(workspaceFile)}
	snapshot.resolve(store)
	slog.Debug("Read workspace", "path", workspaceFile, "generation", snapshot.generation)
	return snapshot
}

// with is the same reading resolved against another store. That is a browser's, which
// a request brings and takes away with it, so it is resolved per call rather than kept.
func (snapshot *workspaceSnapshot) with(store VariableStore) *workspaceSnapshot {
	resolved := &workspaceSnapshot{workspace: snapshot.workspace, logs: snapshot.logs, raw: snapshot.raw, dir: snapshot.dir}
	resolved.resolve(store)
	return resolved
}

func (snapshot *workspaceSnapshot) resolve(store VariableStore) {
	workspace := snapshot.workspace
	resolver := NewResolver(workspace.Variables, store, workspace.Id)
	snapshot.resolver = resolver
	snapshot.generation = generationOf(snapshot.raw, resolver.Statuses())
	snapshot.apps = make(map[string]*snapshotApp, len(workspace.Apps))

	for _, app := range workspace.Apps {
		appType, parameters := flattenApp(app)
		// Expanded quietly: a reference nothing defines is reported where the app is
		// compiled, not on every call that happens to go through here.
		expandAppParameters(parameters, resolver, NewLogger())
		resolveWorkspacePaths(parameters, snapshot.dir)
		entry := &snapshotApp{appType: appType, parameters: parameters}
		if appType == "grpc" {
			entry.metadata = rpc.Metadata(parameters)
			entry.tls = rpc.TLS(parameters)
		}
		snapshot.apps[app.Name] = entry
	}
}

// generationOf hashes what a workspace response is made of beyond the runtime: the
// file as written, and where each variable's value comes from. A stored value that
// appears or goes changes the generation without the file moving, which is what a
// window has to be told about.
func generationOf(raw []byte, statuses []*VariableStatus) string {
	digest := sha256.New()
	digest.Write(raw)
	for _, status := range statuses {
		digest.Write([]byte{0})
		digest.Write([]byte(status.Name))
		digest.Write([]byte{0})
		digest.Write([]byte(status.Source.String()))
		digest.Write([]byte{0})
		digest.Write([]byte(status.EnvName))
	}
	return hex.EncodeToString(digest.Sum(nil))
}

// response is what both doors to the workspace answer with: a copy of the file, so a
// caller editing what it was handed edits nothing the next call reads.
func (snapshot *workspaceSnapshot) response() *GetWorkspaceResponse {
	return &GetWorkspaceResponse{
		Workspace:      proto.Clone(snapshot.workspace).(*Workspace),
		Logs:           append([]*Log(nil), snapshot.logs...),
		VariableStatus: snapshot.resolver.Statuses(),
		Generation:     snapshot.generation,
	}
}

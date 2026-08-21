package agent

import (
	"context"
	"errors"
	"path/filepath"

	"github.com/wham/kaja/v2/pkg/mcp"
)

// Scripts is the workspace's scripts folder as the server reads it. Only the
// reads are here: a server serves a workspace it does not own, so nothing an
// agent asks for may write one — the same rule that keeps Save out of the web
// UI. mcp.Bridge.CanWriteScripts reports that, and the tools that write a file
// are absent from tools/list rather than offered and then refused.
type Scripts interface {
	List() ([]mcp.ScriptInfo, error)
	Read(name string) (string, error)
}

var errReadOnly = errors.New("this Kaja serves a workspace it does not own, so scripts here can be read and run, not written")

// bridge is what kaja's MCP server sees of one browser. Everything that is a
// file is answered by the server, which holds the disk; everything that is a run
// is forwarded to the window, which holds the runtime.
type bridge struct{ session *Session }

func (b *bridge) ListScripts() ([]mcp.ScriptInfo, error) { return b.session.scripts.List() }

func (b *bridge) ReadScript(path string) (string, error) {
	return b.session.scripts.Read(filepath.Base(path))
}

func (b *bridge) WriteScript(path, content string) error { return errReadOnly }
func (b *bridge) DeleteScript(path string) error         { return errReadOnly }
func (b *bridge) CanWriteScripts() bool                  { return false }
func (b *bridge) Activity(inFlight int)                  { b.session.Activity(inFlight) }
func (b *bridge) CreateScript(name, content string) (mcp.ScriptInfo, error) {
	return mcp.ScriptInfo{}, errReadOnly
}
func (b *bridge) RenameScript(path, newName string) (mcp.ScriptInfo, error) {
	return mcp.ScriptInfo{}, errReadOnly
}

// RunScript reads a saved script here rather than asking the window to: the
// server owns the disk, so the window is only ever handed source. The path
// travels with it because that is what the run lands under in the console — its
// name, its history, its row in the sidebar.
func (b *bridge) RunScript(ctx context.Context, path, code, client string) (mcp.RunResult, error) {
	if path != "" {
		content, err := b.session.scripts.Read(filepath.Base(path))
		if err != nil {
			return mcp.RunResult{}, err
		}
		code = content
	}
	return b.session.Run(ctx, path, code, client)
}

func (b *bridge) Catalog() mcp.Catalog {
	b.session.mu.Lock()
	defer b.session.mu.Unlock()
	return b.session.catalog
}

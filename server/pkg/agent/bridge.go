package agent

import (
	"context"

	"github.com/wham/kaja/v2/pkg/mcp"
)

// bridge is what kaja's MCP server sees of one browser, and it is the same bridge in
// both builds. Everything that is a file is answered by the process holding the disk;
// everything that is a run is forwarded to the window, which holds the runtime. A write
// is both: it happens here and is then told to every window.
type bridge struct{ session *Session }

func (b *bridge) scripts() Scripts { return b.session.scripts }

func (b *bridge) ListScripts() ([]mcp.ScriptInfo, error) { return b.scripts().List() }

func (b *bridge) ReadScript(path string) (string, error) {
	script, err := b.scripts().Read(path)
	if err != nil {
		return "", err
	}
	return script.Content, nil
}

func (b *bridge) WriteScript(path, content string) error {
	_, err := b.change(b.scripts().Write(path, content))
	return err
}

func (b *bridge) CreateScript(name, content string) (mcp.ScriptInfo, error) {
	return b.change(b.scripts().Create(name, content))
}

func (b *bridge) RenameScript(path, newName string) (mcp.ScriptInfo, error) {
	return b.change(b.scripts().Rename(path, newName))
}

func (b *bridge) DeleteScript(path string) error {
	_, err := b.change(b.scripts().Delete(path))
	return err
}

// change publishes a write that happened and answers with the file it left behind.
func (b *bridge) change(change ScriptChange, err error) (mcp.ScriptInfo, error) {
	if err != nil {
		return mcp.ScriptInfo{}, err
	}
	b.session.ScriptChanged(change)
	return change.Script(), nil
}

func (b *bridge) CanWriteScripts() bool { return b.scripts().CanWrite() }
func (b *bridge) Activity(inFlight int) { b.session.Activity(inFlight) }

// RunScript reads a saved script here rather than asking the window to: the process
// serving the agent owns the disk, so the window is only ever handed source. The
// script's own path travels with it because that is what the run lands under.
func (b *bridge) RunScript(ctx context.Context, path, code, client string) (mcp.RunResult, error) {
	if path != "" {
		script, err := b.scripts().Read(path)
		if err != nil {
			return mcp.RunResult{}, err
		}
		path, code = script.Path, script.Content
	}
	return b.session.Run(ctx, path, code, client)
}

func (b *bridge) Catalog() mcp.Catalog {
	b.session.mu.Lock()
	defer b.session.mu.Unlock()
	return b.session.catalog
}

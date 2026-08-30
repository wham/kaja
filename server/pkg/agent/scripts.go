package agent

import (
	"context"
	"errors"

	"github.com/wham/kaja/v2/pkg/api"
	"github.com/wham/kaja/v2/pkg/mcp"
)

// Scripts is the workspace's scripts folder as the process holding it reads and
// writes it, and the one thing the two builds genuinely differ by: the desktop owns
// the workspace it opened, a deployed kaja serves one it does not. Where the writes
// are refused, mcp.Bridge.CanWriteScripts reports it and the tools that write a file
// are absent from tools/list rather than offered and then refused.
type Scripts interface {
	List() ([]mcp.ScriptInfo, error)
	// Read resolves whatever the agent has — a path out of a listing, or a bare name —
	// and answers with the script, its canonical path included. That path is what a run
	// lands under in the window: its console, its history, its row in the sidebar.
	Read(path string) (mcp.ScriptInfo, error)
	Write(path, content string) (ScriptChange, error)
	Create(name, content string) (ScriptChange, error)
	Rename(path, newName string) (ScriptChange, error)
	Delete(path string) (ScriptChange, error)
	CanWrite() bool
}

// ScriptChange is what a write did to a file. It is one value because it has one job
// on each side: what the agent is answered with, and what every window is told, so a
// sidebar and an open editor stay in step with a write nobody in the window made.
type ScriptChange struct {
	// Action is "write", "create", "rename" or "delete".
	Action string `json:"action"`
	Path   string `json:"path"`
	// OldPath is where a renamed file was, and is set for nothing else.
	OldPath string `json:"oldPath,omitempty"`
	Name    string `json:"name,omitempty"`
	Folder  string `json:"folder,omitempty"`
	// Content is carried by a write and a create — the create's is what lets a window
	// recognise the agent's own draft being saved, in which case the draft goes with it.
	Content string `json:"content,omitempty"`
}

// Script is the change read as the file it left behind, which is what a tool answers
// with.
func (c ScriptChange) Script() mcp.ScriptInfo {
	return mcp.ScriptInfo{Path: c.Path, Name: c.Name, Folder: c.Folder, Content: c.Content}
}

// ErrReadOnly is every write a served workspace refuses.
var ErrReadOnly = errors.New("this Kaja serves a workspace it does not own, so scripts here can be read and run, not written")

// workspaceScripts reads the scripts folder through the same Api service the
// browser's own sidebar goes through, so an agent and the window it is driving
// are looking at one list, resolved by one rule — a name is validated and opened
// inside the folder through an os.Root, never joined onto anything.
type workspaceScripts struct{ service *api.ApiService }

// NewWorkspaceScripts is the Scripts a deployed kaja serves.
func NewWorkspaceScripts(service *api.ApiService) Scripts {
	return &workspaceScripts{service: service}
}

func (w *workspaceScripts) List() ([]mcp.ScriptInfo, error) {
	response, err := w.service.ListScripts(context.Background(), &api.ListScriptsRequest{})
	if err != nil {
		return nil, err
	}
	scripts := make([]mcp.ScriptInfo, 0, len(response.Scripts))
	for _, script := range response.Scripts {
		scripts = append(scripts, mcp.ScriptInfo{Path: script.Path, Name: script.Name, Folder: script.Folder})
	}
	return scripts, nil
}

func (w *workspaceScripts) Read(path string) (mcp.ScriptInfo, error) {
	response, err := w.service.ReadScript(context.Background(), &api.ReadScriptRequest{Name: w.name(path)})
	if err != nil {
		return mcp.ScriptInfo{}, err
	}
	if response.Script == nil {
		return mcp.ScriptInfo{}, nil
	}
	script := response.Script
	return mcp.ScriptInfo{Path: script.Path, Name: script.Name, Folder: script.Folder, Content: script.Content}, nil
}

// name reduces a path to the name inside the scripts folder that ReadScript takes.
// The listing is what says which one: an agent is handed absolute paths and hands them
// back, and a file in a folder is not its own base name. Anything the listing doesn't
// claim is passed on as it arrived, so a name typed by hand still resolves and a path
// that names nothing fails saying so.
func (w *workspaceScripts) name(path string) string {
	scripts, err := w.List()
	if err != nil {
		return path
	}
	for _, script := range scripts {
		if script.Path != path {
			continue
		}
		if script.Folder == "" {
			return script.Name
		}
		return script.Folder + "/" + script.Name
	}
	return path
}

func (w *workspaceScripts) Write(path, content string) (ScriptChange, error) {
	return ScriptChange{}, ErrReadOnly
}

func (w *workspaceScripts) Create(name, content string) (ScriptChange, error) {
	return ScriptChange{}, ErrReadOnly
}

func (w *workspaceScripts) Rename(path, newName string) (ScriptChange, error) {
	return ScriptChange{}, ErrReadOnly
}

func (w *workspaceScripts) Delete(path string) (ScriptChange, error) {
	return ScriptChange{}, ErrReadOnly
}

func (w *workspaceScripts) CanWrite() bool { return false }

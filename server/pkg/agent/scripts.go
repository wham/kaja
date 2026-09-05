package agent

import (
	"context"

	"github.com/wham/kaja/v2/pkg/api"
	"github.com/wham/kaja/v2/pkg/mcp"
)

// Scripts is the workspace's scripts folder as the process holding it reads and
// writes it. Whether the writes are refused is settled at startup — the desktop owns
// the workspace it opened, a deployed kaja serves one it does not — and where they
// are, mcp.Bridge.CanWriteScripts reports it and the tools that write a file are
// absent from tools/list rather than offered and then refused.
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
// with. The agent is answered with the workspace-relative name; the absolute Path is
// what the windows are told, because it is what they key a console on.
func (c ScriptChange) Script() mcp.ScriptInfo {
	return mcp.ScriptInfo{Path: relativeScriptName(c.Folder, c.Name), Name: c.Name, Folder: c.Folder, Content: c.Content, RunPath: c.Path}
}

// workspaceScripts reads and writes the scripts folder through the same Api service
// the window's own sidebar goes through, so an agent and the window it is driving are
// looking at one list, resolved by one rule — a name is reduced to a relative path and
// opened inside the folder through an os.Root, never joined onto anything. Whether the
// writes are refused is the service's answer, not this type's, which is why both
// builds are this one implementation.
type workspaceScripts struct{ service *api.ApiService }

// NewWorkspaceScripts is the Scripts both builds serve: the desktop owns the workspace
// it opened, a deployed kaja serves one it does not, and the service settles which at
// startup.
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
		scripts = append(scripts, scriptInfo(script))
	}
	return scripts, nil
}

func (w *workspaceScripts) Read(path string) (mcp.ScriptInfo, error) {
	response, err := w.service.ReadScript(context.Background(), &api.ReadScriptRequest{Name: path})
	if err != nil {
		return mcp.ScriptInfo{}, err
	}
	return scriptInfo(response.Script), nil
}

func (w *workspaceScripts) Write(path, content string) (ScriptChange, error) {
	response, err := w.service.WriteScript(context.Background(), &api.WriteScriptRequest{Name: path, Content: content})
	if err != nil {
		return ScriptChange{}, err
	}
	return change("write", "", response.Script), nil
}

func (w *workspaceScripts) Create(name, content string) (ScriptChange, error) {
	response, err := w.service.CreateScript(context.Background(), &api.CreateScriptRequest{Name: name, Content: content})
	if err != nil {
		return ScriptChange{}, err
	}
	return change("create", "", response.Script), nil
}

func (w *workspaceScripts) Rename(path, newName string) (ScriptChange, error) {
	// Read where the file was before it moves: the window keys a console and an open
	// view on that path, and after the rename nothing can say what it used to be.
	from := w.service.ScriptPath(path)
	response, err := w.service.RenameScript(context.Background(), &api.RenameScriptRequest{Name: path, NewName: newName})
	if err != nil {
		return ScriptChange{}, err
	}
	return change("rename", from, response.Script), nil
}

func (w *workspaceScripts) Delete(path string) (ScriptChange, error) {
	resolved := w.service.ScriptPath(path)
	if _, err := w.service.DeleteScript(context.Background(), &api.DeleteScriptRequest{Name: path}); err != nil {
		return ScriptChange{}, err
	}
	return ScriptChange{Action: "delete", Path: resolved}, nil
}

func (w *workspaceScripts) CanWrite() bool { return w.service.CanWriteWorkspace() }

func scriptInfo(script *api.Script) mcp.ScriptInfo {
	if script == nil {
		return mcp.ScriptInfo{}
	}
	return mcp.ScriptInfo{
		Path:    relativeScriptName(script.Folder, script.Name),
		Name:    script.Name,
		Folder:  script.Folder,
		Content: script.Content,
		RunPath: script.Path,
	}
}

// relativeScriptName is the script's place under the scripts root, which is the name
// the agent is given and hands back. The service resolves a relative name and an
// absolute one alike, so this is the same file said without saying where the
// workspace lives.
func relativeScriptName(folder string, name string) string {
	if folder == "" {
		return name
	}
	return folder + "/" + name
}

func change(action string, oldPath string, script *api.Script) ScriptChange {
	info := scriptInfo(script)
	return ScriptChange{Action: action, OldPath: oldPath, Path: info.Path, Name: info.Name, Folder: info.Folder, Content: info.Content}
}

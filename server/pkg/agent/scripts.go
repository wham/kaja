package agent

import (
	"context"

	"github.com/wham/kaja/v2/pkg/api"
	"github.com/wham/kaja/v2/pkg/mcp"
)

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
		scripts = append(scripts, mcp.ScriptInfo{Path: script.Path, Name: script.Name})
	}
	return scripts, nil
}

func (w *workspaceScripts) Read(name string) (string, error) {
	response, err := w.service.ReadScript(context.Background(), &api.ReadScriptRequest{Name: name})
	if err != nil {
		return "", err
	}
	if response.Script == nil {
		return "", nil
	}
	return response.Script.Content, nil
}

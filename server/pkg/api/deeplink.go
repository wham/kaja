package api

import (
	"net/url"
	"path"
	"strings"
)

// The grammar is scriptLink.ts's; the two have to agree.

// LinkedScriptName is the script a kaja://run/<script> link names, "" where it names none.
func LinkedScriptName(link string) string {
	parsed, err := url.Parse(strings.TrimSpace(link))
	if err != nil || parsed.Scheme != "kaja" || !strings.EqualFold(parsed.Host, "run") {
		return ""
	}
	segments := strings.Split(strings.TrimLeft(parsed.Path, "/"), "/")
	for i, segment := range segments {
		if decoded, err := url.PathUnescape(segment); err == nil {
			segments[i] = decoded
		}
	}
	return linkName(strings.TrimSpace(strings.Join(segments, "/")))
}

// WorkspaceHasScript reads the disk, so it can be asked of a workspace nothing has opened.
func WorkspaceHasScript(configurationPath string, named string) bool {
	dir, _ := workspaceScriptsRoot(configurationPath)
	found := false
	_ = walkScripts(dir, func(relative string) {
		if isLinkedScript(relative, named) {
			found = true
		}
	}, nil)
	return found
}

func linkName(name string) string {
	return strings.TrimSuffix(name, ".ts")
}

func isLinkedScript(relative string, named string) bool {
	wanted := linkName(named)
	if linkName(relative) == wanted {
		return true
	}
	return !strings.Contains(wanted, "/") && path.Base(linkName(relative)) == wanted
}

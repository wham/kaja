package api

import (
	"net/url"
	"path"
	"strings"
)

// A deeplink names a script and nothing about where the script is, so the process
// that receives one has to find the workspace it is in before a window can run it.
// The grammar is scriptLink.ts's: the verb is the host, the script is the path, with
// or without its extension, and a name with no folder in it matches by base name.

// LinkedScriptName is the script a kaja://run/<script> link names, without its
// extension, or "" where the link is not one that runs a script.
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

// WorkspaceHasScript reports whether the workspace a configuration file names holds
// the script a link names, read off the disk rather than asked of a window, so it can
// be asked of a workspace nothing has opened.
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

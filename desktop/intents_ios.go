//go:build ios

package main

/*
#include <stdlib.h>

// Implemented in build/ios/intents/Intents.swift.
extern void kajaRefreshShortcuts(void);
*/
import "C"

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"time"

	"github.com/wham/kaja/v2/pkg/agent"
)

// An App Intent is the phone's owner asking, so it reaches the session whatever the
// agent switch says: the switch is about the loopback listener, which nothing on a
// phone can reach.
const appIntents = true

// mcpListener is false because a loopback port on a phone is one no agent can reach,
// so the switch, the page and the listener are not offered there at all.
const mcpListener = false

// intentClient is who an intent's runs are made as, which is the name the agent draft
// wears in the sidebar.
const intentClient = "Siri"

// readyWait is how long an intent waits for the window it opened to attach and say
// what is callable. A cold launch compiles every app before the catalog is pushed.
const readyWait = 30 * time.Second

var intentsApp atomic.Pointer[App]

func serveIntents(a *App) {
	intentsApp.Store(a)
	go func() { C.kajaRefreshShortcuts() }()
}

// kajaCallTool is what every App Intent calls: one MCP tool, its arguments as JSON,
// answered with a JSON ToolResult the caller frees.
//
//export kajaCallTool
func kajaCallTool(tool, arguments *C.char) *C.char {
	encoded, _ := json.Marshal(callTool(C.GoString(tool), C.GoString(arguments)))
	return C.CString(string(encoded))
}

func callTool(tool, arguments string) agent.ToolResult {
	args := map[string]any{}
	if arguments != "" {
		if err := json.Unmarshal([]byte(arguments), &args); err != nil {
			return agent.ToolResult{Text: "The intent's arguments are not JSON: " + err.Error(), IsError: true}
		}
	}
	session := awaitSession(!onDisk[tool])
	if session == nil {
		return agent.ToolResult{Text: "Kaja's window did not come up in time. Open Kaja and try again.", IsError: true}
	}
	result, err := session.Call(context.Background(), intentClient, tool, args)
	if err != nil {
		return agent.ToolResult{Text: err.Error(), IsError: true}
	}
	return result
}

// onDisk are the tools Go answers off the scripts folder alone. Shortcuts fills a
// script picker from a process it launched in the background, where no window comes up.
var onDisk = map[string]bool{"list_scripts": true, "read_script": true}

// awaitSession waits out a cold launch: the intent runs as soon as the process does,
// which is before main has an App and well before the window has compiled anything.
// The session is opened on every call because one no window kept is swept.
func awaitSession(needsWindow bool) *agent.Session {
	deadline := time.Now().Add(readyWait)
	for time.Now().Before(deadline) {
		if a := intentsApp.Load(); a != nil {
			a.mcpMu.Lock()
			token := a.mcpToken
			a.mcpMu.Unlock()
			if token != "" {
				if session, err := a.agents.Open(token); err == nil && (!needsWindow || session.Ready()) {
					return session
				}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	return nil
}

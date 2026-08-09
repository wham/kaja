package mcp

import (
	"encoding/json"
	"fmt"
)

// listPageLimit bounds how many pages of a paginated list kaja walks. A server
// that never stops handing out cursors would otherwise hold the app open
// forever; the app is a catalog of what a server exposes, not a crawler.
const listPageLimit = 20

// ReadSurface reads everything the server exposes: what it says it is, and the
// tools, resources and prompts it lists. It is what both opening an app and
// inspecting one are built on.
func (c *Client) ReadSurface(log func(string)) (*Surface, error) {
	if err := c.ensureEra(); err != nil {
		return nil, err
	}

	c.mu.Lock()
	surface := &Surface{ProtocolVersion: c.version, Legacy: c.legacy}
	greeting := c.greeting
	c.mu.Unlock()

	readGreeting(greeting, surface)
	if log != nil {
		name := surface.ServerInfo.Name
		if name == "" {
			name = "the server"
		}
		era := "MCP " + surface.ProtocolVersion
		if surface.Legacy {
			era += " (handshake)"
		}
		log(fmt.Sprintf("Connected to %s %s over %s", name, surface.ServerInfo.Version, era))
	}

	// A server that declares no capabilities at all is asked anyway: the
	// declaration is advice, and an empty list is a cheap answer either way.
	declared := surface.Capabilities
	unknown := declared.Tools == nil && declared.Resources == nil && declared.Prompts == nil

	if declared.Tools != nil || unknown {
		tools, err := listAll[Tool](c, "tools/list", "tools")
		if err != nil {
			return nil, fmt.Errorf("listing tools: %w", err)
		}
		surface.Tools = tools
	}
	if declared.Resources != nil || unknown {
		// Resources are optional even where the capability is declared, and a
		// server that lists none is still worth opening for its tools.
		if resources, err := listAll[Resource](c, "resources/list", "resources"); err == nil {
			surface.Resources = resources
		}
		if templates, err := listAll[ResourceTemplate](c, "resources/templates/list", "resourceTemplates"); err == nil {
			surface.ResourceTemplates = templates
		}
	}
	if declared.Prompts != nil || unknown {
		if prompts, err := listAll[Prompt](c, "prompts/list", "prompts"); err == nil {
			surface.Prompts = prompts
		}
	}

	if log != nil {
		log(fmt.Sprintf("Listed %d tool(s), %d resource(s), %d prompt(s)", len(surface.Tools), len(surface.Resources), len(surface.Prompts)))
	}
	return surface, nil
}

// readGreeting reads what the server said about itself while the era was
// settled. The two eras put the same facts in different places: a DiscoverResult
// carries serverInfo in `_meta` and lists every version it speaks, while an
// InitializeResult names one version and carries serverInfo at the top level.
func readGreeting(greeting json.RawMessage, surface *Surface) {
	var payload struct {
		SupportedVersions []string        `json:"supportedVersions"`
		ProtocolVersion   string          `json:"protocolVersion"`
		Capabilities      Capabilities    `json:"capabilities"`
		ServerInfo        *Implementation `json:"serverInfo"`
		Instructions      string          `json:"instructions"`
		Meta              json.RawMessage `json:"_meta"`
	}
	if json.Unmarshal(greeting, &payload) != nil {
		return
	}

	surface.Capabilities = payload.Capabilities
	surface.Instructions = payload.Instructions
	surface.SupportedVersions = payload.SupportedVersions
	if payload.ProtocolVersion != "" {
		surface.ProtocolVersion = payload.ProtocolVersion
	}
	if payload.ServerInfo != nil {
		surface.ServerInfo = *payload.ServerInfo
	}
	if surface.ServerInfo.Name == "" && len(payload.Meta) > 0 {
		var meta map[string]json.RawMessage
		if json.Unmarshal(payload.Meta, &meta) == nil {
			var info Implementation
			if json.Unmarshal(meta[metaServerInfo], &info) == nil {
				surface.ServerInfo = info
			}
		}
	}
}

// listAll walks a paginated list method to the end, gathering the items under
// the given result key.
func listAll[T any](c *Client, method string, key string) ([]T, error) {
	var items []T
	cursor := ""
	for page := 0; page < listPageLimit; page++ {
		params := map[string]any{}
		if cursor != "" {
			params["cursor"] = cursor
		}
		result, _, err := c.send(method, params, nil)
		if err != nil {
			return nil, err
		}
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(result, &raw); err != nil {
			return nil, fmt.Errorf("reading %s: %w", method, err)
		}
		if list, ok := raw[key]; ok {
			var found []T
			if err := json.Unmarshal(list, &found); err != nil {
				return nil, fmt.Errorf("reading %s: %w", method, err)
			}
			items = append(items, found...)
		}
		var next string
		_ = json.Unmarshal(raw["nextCursor"], &next)
		if next == "" || next == cursor {
			break
		}
		cursor = next
	}
	return items, nil
}

package mcp

import (
	"net/http/httptest"
	"testing"

	client "github.com/wham/kaja/v2/pkg/apps/mcp"
)

// Kaja speaks MCP at both ends - its own server here, and the MCP app's client at
// somebody else's server - and the two were written against the same revisions. So the
// client is pointed at the server: it settles the era the way it would against any
// server, and what it reads back is what an agent is offered.
func TestTheAppsClientReadsThisServer(t *testing.T) {
	bridge := newFakeBridge()
	endpoint := httptest.NewServer(NewServer(bridge, token, version))
	t.Cleanup(endpoint.Close)

	surface, err := client.NewClient(endpoint.URL, func() (map[string]string, error) {
		return map[string]string{"Authorization": "Bearer " + token}, nil
	}, endpoint.Client()).ReadSurface(nil)
	if err != nil {
		t.Fatalf("reading the surface: %v", err)
	}

	// Discovery settled it, so no handshake was needed and there is no session to hold.
	if surface.Legacy {
		t.Errorf("the client fell back to the handshake era")
	}
	if surface.ProtocolVersion != client.ProtocolVersion {
		t.Errorf("protocol version = %q", surface.ProtocolVersion)
	}
	// The modern era has no handshake to name the server in, so it rides in the result's
	// own metadata - which is the half most easily left out.
	if surface.ServerInfo.Name != serverName || surface.ServerInfo.Version != version {
		t.Errorf("serverInfo = %+v", surface.ServerInfo)
	}
	if len(surface.Tools) == 0 {
		t.Fatalf("no tools listed")
	}
	if len(surface.Resources) != 2 {
		t.Errorf("resources = %d, want 2", len(surface.Resources))
	}
	contains(t, surface.Instructions, "describe_method")

	for _, tool := range surface.Tools {
		if tool.Title == "" || tool.Annotations == nil {
			t.Errorf("%s arrived without a title or annotations", tool.Name)
		}
		if tool.Name == "run_script" && tool.OutputSchema == nil {
			t.Errorf("run_script arrived without its output schema")
		}
	}
}

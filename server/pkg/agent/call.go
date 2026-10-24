package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
)

// ToolResult is a tool's answer as a caller with no JSON-RPC of its own reads it.
type ToolResult struct {
	Text    string `json:"text"`
	IsError bool   `json:"isError"`
}

// Call answers one tool call from inside this process, as the named client. It goes
// through the session's own MCP server rather than around it, so a caller here is
// answered exactly as an agent on the wire is: the same identity, write gate, run
// report and failure advice, with nothing to keep in step.
func (s *Session) Call(ctx context.Context, client, tool string, arguments map[string]any) (ToolResult, error) {
	if arguments == nil {
		arguments = map[string]any{}
	}
	body, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "tools/call",
		"params": map[string]any{
			"name":      tool,
			"arguments": arguments,
			"_meta": map[string]any{
				"io.modelcontextprotocol/clientInfo": map[string]string{"name": client},
			},
		},
	})
	if err != nil {
		return ToolResult{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "/mcp", bytes.NewReader(body))
	if err != nil {
		return ToolResult{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+s.token)
	recorder := httptest.NewRecorder()
	s.server.ServeHTTP(recorder, request)

	var response struct {
		Result *struct {
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
			IsError bool `json:"isError"`
		} `json:"result"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		return ToolResult{}, fmt.Errorf("the MCP server answered %d with %q", recorder.Code, strings.TrimSpace(recorder.Body.String()))
	}
	if response.Error != nil {
		return ToolResult{}, fmt.Errorf("%s", response.Error.Message)
	}
	if response.Result == nil {
		return ToolResult{}, fmt.Errorf("the MCP server answered %d with no result", recorder.Code)
	}
	var text []string
	for _, block := range response.Result.Content {
		if block.Type == "text" {
			text = append(text, block.Text)
		}
	}
	return ToolResult{Text: strings.Join(text, "\n\n"), IsError: response.Result.IsError}, nil
}

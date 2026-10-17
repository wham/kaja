package api

import (
	"context"
	"os"
	"testing"
	"time"
)

// The workspace is read once and every call reads that reading, which is only right
// if everything that could change it drops it: a write through the service, a stored
// value appearing, and an edit made outside kaja.
func TestSnapshotIsDroppedByWhatChangesIt(t *testing.T) {
	path := writeWorkspace(t, `{"variables": {"TOKEN": "${secret}"}}`)
	store := &fakeStore{available: true}
	service := NewApiService(path, true, "", "", store)
	defer service.Close()
	ctx := context.Background()

	before, _ := service.GetWorkspace(ctx, &GetWorkspaceRequest{})
	if got := statusIn(before.VariableStatus, "TOKEN"); got != VariableSource_VARIABLE_SOURCE_UNSET {
		t.Fatalf("TOKEN resolves %v before anything is stored", got)
	}
	if same, _ := service.GetWorkspace(ctx, &GetWorkspaceRequest{}); same.Generation != before.Generation {
		t.Fatalf("two readings of one state have two generations: %s, %s", before.Generation, same.Generation)
	}

	// A stored value moves nothing on disk, and still has to be seen.
	if _, err := service.SetStoredValue(ctx, &SetStoredValueRequest{Name: "TOKEN", Value: "s3cr3t"}); err != nil {
		t.Fatalf("SetStoredValue: %v", err)
	}
	stored, _ := service.GetWorkspace(ctx, &GetWorkspaceRequest{})
	if got := statusIn(stored.VariableStatus, "TOKEN"); got != VariableSource_VARIABLE_SOURCE_KEYCHAIN {
		t.Errorf("TOKEN resolves %v after being stored, want the keychain", got)
	}
	if stored.Generation == before.Generation {
		t.Error("the generation did not move with the variable's status")
	}
	if got := service.Variables().Expand("${TOKEN}"); got != "s3cr3t" {
		t.Errorf("a call expands ${TOKEN} to %q, want the stored value", got)
	}

	// A write through the service.
	if _, err := service.UpdateWorkspace(ctx, &UpdateWorkspaceRequest{Workspace: &Workspace{
		Variables: map[string]string{"TOKEN": "${secret}"},
		Apps:      []*WorkspaceApp{{Name: "quirks", App: &WorkspaceApp_Twirp{Twirp: &TwirpApp{Url: "http://localhost:8080", ProtoDir: "quirks/proto"}}}},
	}}); err != nil {
		t.Fatalf("UpdateWorkspace: %v", err)
	}
	written, _ := service.GetWorkspace(ctx, &GetWorkspaceRequest{})
	if len(written.Workspace.Apps) != 1 || written.Generation == stored.Generation {
		t.Errorf("after a write the service answers %d apps at generation %s, want the written file", len(written.Workspace.Apps), written.Generation)
	}
	if connection := service.appConnection("quirks"); connection.Parameters["url"] != "http://localhost:8080" {
		t.Errorf("the door reads %v for the app just written", connection.Parameters)
	}

	// An edit made outside kaja, which only the watcher can notice.
	if err := os.WriteFile(path, []byte(`{"variables": {"TOKEN": "${secret}"}, "apps": []}`), 0o644); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(10 * time.Second)
	for {
		edited, _ := service.GetWorkspace(ctx, &GetWorkspaceRequest{})
		if len(edited.Workspace.Apps) == 0 {
			if edited.Generation == written.Generation {
				t.Error("the file changed and the generation did not")
			}
			return
		}
		select {
		case <-deadline:
			t.Fatal("an edit made outside kaja was never read")
		case <-time.After(100 * time.Millisecond):
		}
	}
}

// What a response is handed is a copy: editing it must not edit what the next call
// reads.
func TestWorkspaceResponseIsACopy(t *testing.T) {
	service := NewApiService(writeWorkspace(t, `{"apps": []}`), true, "", "", nil)
	defer service.Close()
	response, _ := service.GetWorkspace(context.Background(), &GetWorkspaceRequest{})
	response.Workspace.Apps = append(response.Workspace.Apps, &WorkspaceApp{Name: "stray"})
	again, _ := service.GetWorkspace(context.Background(), &GetWorkspaceRequest{})
	if len(again.Workspace.Apps) != 0 {
		t.Fatal("editing a response edited the snapshot")
	}
}

func TestGenerationFollowsContentAndStatuses(t *testing.T) {
	statuses := []*VariableStatus{{Name: "TOKEN", Source: VariableSource_VARIABLE_SOURCE_UNSET, EnvName: "KAJA_TOKEN"}}
	base := generationOf([]byte(`{"apps":[]}`), statuses)
	if base != generationOf([]byte(`{"apps":[]}`), statuses) {
		t.Error("the same state has two generations")
	}
	if base == generationOf([]byte(`{"apps": []}`), statuses) {
		t.Error("the file's bytes moved and the generation did not")
	}
	if base == generationOf([]byte(`{"apps":[]}`), []*VariableStatus{{Name: "TOKEN", Source: VariableSource_VARIABLE_SOURCE_KEYCHAIN, EnvName: "KAJA_TOKEN"}}) {
		t.Error("a variable's source moved and the generation did not")
	}
}

func statusIn(statuses []*VariableStatus, name string) VariableSource {
	for _, status := range statuses {
		if status.Name == name {
			return status.Source
		}
	}
	return VariableSource(-1)
}

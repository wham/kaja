package apps

import (
	"context"
	"testing"
)

type stubApp struct {
	instance *stubInstance
}

func (a *stubApp) Open(parameters map[string]string, protoDir string, log func(string)) (*Opened, error) {
	return &Opened{Instance: a.instance}, nil
}

type stubInstance struct {
	name string
}

func (i *stubInstance) Invoke(ctx context.Context, call *Call) (Stream, error) {
	return OneMessage([]byte(i.name), nil), nil
}

func openedUnder(t *testing.T, manager *Manager, name string) string {
	t.Helper()
	stream, err := manager.Invoke(context.Background(), name, &Call{})
	if err != nil {
		t.Fatalf("no app is open under %q: %v", name, err)
	}
	body, err := stream.Recv()
	if err != nil {
		t.Fatalf("the app open under %q answered with nothing: %v", name, err)
	}
	return string(body)
}

// A rename leaves an app's parameters alone - that is what makes it a rename rather
// than a different app - so the instance that is open is the right one and only the
// name it answers to has moved. Reopening it would mean reading the upstream again
// for a surface that has not changed.
func TestManagerRenameMovesTheOpenApp(t *testing.T) {
	manager := NewManager(map[string]App{"grpc": &stubApp{instance: &stubInstance{name: "theatre"}}})
	if _, err := manager.Open("theatre", "grpc", nil, "", func(string) {}); err != nil {
		t.Fatalf("failed to open the app: %v", err)
	}

	manager.Rename("theatre", "playhouse")

	if answered := openedUnder(t, manager, "playhouse"); answered != "theatre" {
		t.Errorf("the new name answered with %q, want the app that was open", answered)
	}
	if _, err := manager.Invoke(context.Background(), "theatre", &Call{}); err == nil {
		t.Error("the old name still answers, so an app is open twice over")
	}
}

// Two windows watching one file both follow the same rename, and the second one has
// nothing left to move. Neither is that a failure when the app was never opened at
// all, which is every app a compilation never got to.
func TestManagerRenameLeavesAnUnopenedAppAlone(t *testing.T) {
	manager := NewManager(map[string]App{"grpc": &stubApp{instance: &stubInstance{name: "theatre"}}})
	if _, err := manager.Open("theatre", "grpc", nil, "", func(string) {}); err != nil {
		t.Fatalf("failed to open the app: %v", err)
	}

	manager.Rename("seating", "stalls")
	manager.Rename("theatre", "theatre")

	if answered := openedUnder(t, manager, "theatre"); answered != "theatre" {
		t.Errorf("the app answered with %q, want the app that was open", answered)
	}
	if _, err := manager.Invoke(context.Background(), "stalls", &Call{}); err == nil {
		t.Error("a name nothing was open under became an open app")
	}
}

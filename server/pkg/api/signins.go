package api

import (
	"context"
	"fmt"
	"strings"

	"github.com/wham/kaja/v2/pkg/oauth"
)

// signInStore keeps a sign-in where a "${secret}" variable keeps its value: in the
// variable store, under the workspace's id and the variable's name. So a sign-in
// travels wherever the store carries the workspace's values, and a workspace is
// signed in as whoever signed in there.
type signInStore struct {
	service *ApiService
}

func (s signInStore) Available(ctx context.Context) bool {
	return s.service.variableStoreAvailable(ctx)
}

func (s signInStore) Load(ctx context.Context, name string) (string, bool) {
	workspaceID := s.service.snapshot().workspace.GetId()
	if workspaceID == "" || !s.Available(ctx) {
		return "", false
	}
	return s.service.valueStore(ctx).Get(workspaceID, name)
}

func (s signInStore) Save(ctx context.Context, name string, value string) error {
	workspaceID, err := s.service.EnsureWorkspaceID()
	if err != nil {
		return err
	}
	if err := s.service.valueStore(ctx).Set(workspaceID, name, value); err != nil {
		return err
	}
	s.service.storedValueChanged(ctx)
	return nil
}

func (s signInStore) Delete(ctx context.Context, name string) error {
	workspaceID := s.service.snapshot().workspace.GetId()
	if workspaceID == "" || !s.Available(ctx) {
		return nil
	}
	if err := s.service.valueStore(ctx).Delete(workspaceID, name); err != nil {
		return err
	}
	s.service.storedValueChanged(ctx)
	return nil
}

// storedValueChanged tells every window watching the workspace that a variable's
// status may have moved. A stored value is not in kaja.json, so the file's own
// watcher has nothing to see. A browser's value moved for that browser alone, which
// hears it in the trailer and watches again.
func (s *ApiService) storedValueChanged(ctx context.Context) {
	if s.browserValues(ctx) != nil {
		return
	}
	s.invalidateSnapshot()
	s.watcherMu.Lock()
	watcher := s.watcher
	s.watcherMu.Unlock()
	if watcher != nil {
		go watcher.notify()
	}
}

// signInVariable is the variable an app's credential keeps its sign-in in, checked
// against what the workspace already says that name is.
func (s *ApiService) signInVariable(credential string) (string, error) {
	name, ok := oauth.SignInName(credential)
	if !ok {
		return "", fmt.Errorf("the app names no variable to keep its sign-in in")
	}
	if configured, defined := s.snapshot().workspace.GetVariables()[name]; defined && strings.TrimSpace(configured) != SignInSource {
		return "", fmt.Errorf("the variable %s already holds a value of its own, so it can't hold a sign-in too", name)
	}
	return name, nil
}

// defineSignIn writes the variable a sign-in was kept under into kaja.json, so the
// file names it like any other value it keeps outside itself.
func (s *ApiService) defineSignIn(name string) error {
	if _, defined := s.snapshot().workspace.GetVariables()[name]; defined {
		return nil
	}
	return s.MutateWorkspace(func(workspace *Workspace) error {
		if workspace.Variables == nil {
			workspace.Variables = map[string]string{}
		}
		if _, defined := workspace.Variables[name]; !defined {
			workspace.Variables[name] = SignInSource
		}
		return nil
	})
}

// redact masks what a call reports having sent: every value kaja.json does not
// carry, and every token a sign-in handed out, back to the reference naming it.
func (s *ApiService) redact(resolver *Resolver, reported map[string]string, sent map[string]string) map[string]string {
	redacted := resolver.Redact(reported, sent)
	if s == nil || len(redacted) == 0 {
		return redacted
	}
	tokens := s.authorizer.Sent()
	if len(tokens) == 0 {
		return redacted
	}
	masked := make(map[string]string, len(redacted))
	for key, value := range redacted {
		for name, token := range tokens {
			if len(token) >= maskableLength {
				value = strings.ReplaceAll(value, token, "${"+name+"}")
			}
		}
		masked[key] = value
	}
	return masked
}

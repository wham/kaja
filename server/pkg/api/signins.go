package api

import (
	"context"
	"strings"

	"github.com/wham/kaja/v2/pkg/apps/mcp"
	"github.com/wham/kaja/v2/pkg/apps/openapi"
	"github.com/wham/kaja/v2/pkg/oauth"
)

// signInStore keeps a sign-in where a "${secret}" variable keeps its value: in the
// variable store, under the workspace's id and the slot of the server it is for. So
// a sign-in travels wherever the store carries the workspace's values, and a
// workspace is signed in as whoever signed in there.
type signInStore struct {
	service *ApiService
}

// signInMask is what a token a sign-in handed out reads as wherever a call reports
// having sent it.
const signInMask = "${signin}"

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

// redact masks what a call reports having sent: every value kaja.json does not
// carry back to the reference naming it, and every token a sign-in handed out to
// signInMask.
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
		for _, token := range tokens {
			if len(token) >= maskableLength {
				value = strings.ReplaceAll(value, token, signInMask)
			}
		}
		masked[key] = value
	}
	return masked
}

// signInStatuses states, for every app that signs in, whether the store holds its
// sign-in. Which server an app signs in to is read off its parameters, expanded the
// way it opens with them.
func signInStatuses(workspace *Workspace, apps map[string]*snapshotApp, store VariableStore) []*SignInStatus {
	var statuses []*SignInStatus
	for _, app := range workspace.GetApps() {
		entry := apps[app.Name]
		if entry == nil {
			continue
		}
		resource := signInResource(entry.appType, entry.parameters)
		if resource == "" {
			continue
		}
		status := &SignInStatus{App: app.Name, Resource: resource}
		if store != nil && store.Available() && workspace.GetId() != "" {
			if held, ok := store.Get(workspace.GetId(), oauth.Slot(resource)); ok {
				status.SignedIn = oauth.GrantResource(held) == resource
			}
		}
		statuses = append(statuses, status)
	}
	return statuses
}

func signInResource(appType string, parameters map[string]string) string {
	switch appType {
	case "mcp":
		if strings.TrimSpace(parameters["auth"]) == mcp.AuthOAuth {
			return oauth.Resource(parameters["url"])
		}
	case "openapi":
		if resource, ok := openapi.SignInResource(parameters); ok {
			return oauth.Resource(resource)
		}
	}
	return ""
}

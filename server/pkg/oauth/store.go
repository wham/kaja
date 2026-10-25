package oauth

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// Store is where a sign-in is kept: one value under one name, the name being the
// "${signin}" variable an app names its credential by. So a sign-in is the
// workspace's, kept wherever the workspace keeps the values kaja.json only names,
// and two apps in one workspace can be two different people.
//
// Every method is handed the request it serves, because where the values are kept
// can be the request's own: a browser carries its values on each call it makes.
type Store interface {
	// Available reports whether anything can be kept at all.
	Available(ctx context.Context) bool
	Load(ctx context.Context, name string) (string, bool)
	Save(ctx context.Context, name string, value string) error
	Delete(ctx context.Context, name string) error
}

// grant is everything one sign-in needs to be used and renewed: the resource it
// may be sent to, the authorization server that issued it, the token, and the
// client it was issued to, since a refresh has to present the same one.
type grant struct {
	Resource string               `json:"resource"`
	Server   *authorizationServer `json:"server"`
	Token    *tokenSet            `json:"token"`
	// Client is the client the token was issued to, secret included where the
	// server issued one. A sign-in that registered kaja carries that registration,
	// so signing in again under the same name presents the same client rather than
	// leaving another one behind at the server.
	Client *registration `json:"client,omitempty"`
	// Audience is the resource the token was asked for, where the resource
	// metadata named a parent of the endpoint rather than the endpoint itself.
	// Empty is the resource.
	Audience string `json:"audience,omitempty"`
}

func (g *grant) audience() string {
	if g.Audience != "" {
		return g.Audience
	}
	return g.Resource
}

func readGrant(ctx context.Context, store Store, name string) *grant {
	if store == nil || name == "" {
		return nil
	}
	value, ok := store.Load(ctx, name)
	if !ok {
		return nil
	}
	held := &grant{}
	if json.Unmarshal([]byte(value), held) != nil || held.Token == nil || held.Server == nil {
		return nil
	}
	return held
}

func writeGrant(ctx context.Context, store Store, name string, held *grant) error {
	payload, err := json.Marshal(held)
	if err != nil {
		return err
	}
	return store.Save(ctx, name, string(payload))
}

// GrantResource is the resource a kept sign-in is for, or "" where the value is
// not a sign-in. It is what the Variables view says a sign-in is.
func GrantResource(value string) string {
	held := &grant{}
	if json.Unmarshal([]byte(value), held) != nil || held.Token == nil {
		return ""
	}
	return held.Resource
}

var signInReference = regexp.MustCompile(`^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$`)

// SignInName is the variable an app's credential names, where it names one. A
// "${signin}" variable is never expanded, so this is the form it reaches an app in.
func SignInName(credential string) (string, bool) {
	match := signInReference.FindStringSubmatch(strings.TrimSpace(credential))
	if match == nil {
		return "", false
	}
	return match[1], true
}

// signInSlot is the name an app's credential keeps its sign-in under, or an error
// saying the credential names none.
func signInSlot(credential string) (string, error) {
	name, ok := SignInName(credential)
	if !ok {
		return "", fmt.Errorf("the app names no variable to keep its sign-in in")
	}
	return name, nil
}

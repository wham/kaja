package mcp

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// The device authorization grant (RFC 8628), which is what a sign-in is carried
// through where the redirect flow is one kaja cannot finish: the token request
// asks for no client secret, so a public client is all it takes.
//
// It is the same two halves as the redirect flow - something to open, and an
// answer that arrives later - so the window is told about it the same way. What
// differs is that the person carries the code across rather than the browser
// carrying it back, which is why there is no listener here and a `user_code` to
// show instead.

const deviceGrantType = "urn:ietf:params:oauth:grant-type:device_code"

// devicePollInterval is how often the token endpoint is asked where the server
// named no interval of its own, which is the default RFC 8628 states.
const devicePollInterval = 5 * time.Second

// deviceSlowDown is what a `slow_down` adds to the interval, per RFC 8628.
const deviceSlowDown = 5 * time.Second

// deviceAuthorization is what the device authorization endpoint answered with:
// the code kaja polls with, the code the person types, and where they type it.
type deviceAuthorization struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int64  `json:"expires_in"`
	Interval                int64  `json:"interval"`
}

// page is what the window opens. The complete form carries the code already, so
// it is preferred where the server offers one; the code is stated either way,
// since a person who lands on the page without it has nothing to type.
func (d *deviceAuthorization) page() string {
	if d.VerificationURIComplete != "" {
		return d.VerificationURIComplete
	}
	return d.VerificationURI
}

func (d *deviceAuthorization) interval() time.Duration {
	if d.Interval > 0 {
		return time.Duration(d.Interval) * time.Second
	}
	return devicePollInterval
}

func (d *deviceAuthorization) lifetime() time.Duration {
	if d.ExpiresIn > 0 {
		return time.Duration(d.ExpiresIn) * time.Second
	}
	return flowTimeout
}

// requestDeviceAuthorization asks for a code to sign in with. The resource is
// named for the reason the authorization request names it: a token is for one
// server and nothing else.
func requestDeviceAuthorization(client *http.Client, server *authorizationServer, registered *registration, scope, resource string) (*deviceAuthorization, error) {
	form := url.Values{}
	form.Set("client_id", registered.ClientID)
	form.Set("resource", resource)
	if scope != "" {
		form.Set("scope", scope)
	}
	request, err := http.NewRequest(http.MethodPost, server.DeviceAuthorizationEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("calling %s: %w", server.DeviceAuthorizationEndpoint, err)
	}
	defer response.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(response.Body, metadataLimit))
	if refusal := readTokenRefusal(payload); refusal != nil {
		return nil, fmt.Errorf("the authorization server refused to start a sign-in: %w", refusal)
	}
	if response.StatusCode >= 400 {
		return nil, fmt.Errorf("the authorization server refused to start a sign-in: %s", summarize(payload))
	}
	issued := &deviceAuthorization{}
	if err := json.Unmarshal(payload, issued); err != nil || issued.DeviceCode == "" || issued.UserCode == "" {
		return nil, fmt.Errorf("the authorization server's answer is not a device authorization: %s", summarize(payload))
	}
	if issued.VerificationURI == "" && issued.VerificationURIComplete == "" {
		return nil, fmt.Errorf("the authorization server named no page to enter the code on")
	}
	return issued, nil
}

// beginDevice starts a sign-in the person finishes by typing a code, and reports
// how it went on the channel the redirect flow reports on. Nothing about it is
// kept until it finishes, the same as the other flow.
func (a *Authorizer) beginDevice(resource, audience, scope string, server *authorizationServer, registered *registration) (SignInPrompt, <-chan error, error) {
	issued, err := requestDeviceAuthorization(a.client, server, registered, scope, audience)
	if err != nil {
		return SignInPrompt{}, nil, err
	}
	key, err := randomToken()
	if err != nil {
		return SignInPrompt{}, nil, err
	}
	pending := &flow{
		resource:   resource,
		audience:   audience,
		scope:      scope,
		server:     server,
		registered: registered,
		done:       make(chan error, 1),
		stop:       make(chan struct{}),
	}
	a.mu.Lock()
	a.pending[key] = pending
	a.mu.Unlock()
	pending.timer = time.AfterFunc(issued.lifetime(), func() {
		a.settle(key, fmt.Errorf("the code expired before the sign-in was finished"))
	})
	go a.pollDevice(key, pending, issued)
	return SignInPrompt{URL: issued.page(), UserCode: issued.UserCode}, pending.done, nil
}

// pollDevice asks the token endpoint until the person has answered on the other
// device. Everything but `authorization_pending` and `slow_down` ends the flow:
// a refusal repeated every few seconds is a refusal.
func (a *Authorizer) pollDevice(key string, pending *flow, issued *deviceAuthorization) {
	wait := issued.interval()
	for {
		select {
		case <-pending.stop:
			return
		case <-time.After(wait):
		}

		form := url.Values{}
		form.Set("grant_type", deviceGrantType)
		form.Set("device_code", issued.DeviceCode)
		form.Set("resource", pending.audience)
		token, err := requestToken(a.client, pending.server, pending.registered, form)
		var refusal *tokenRefusal
		if errors.As(err, &refusal) {
			switch refusal.Code {
			case "authorization_pending":
				continue
			case "slow_down":
				wait += deviceSlowDown
				continue
			}
		}
		if err != nil {
			a.settle(key, err)
			return
		}
		if token.Scope == "" {
			token.Scope = pending.scope
		}
		a.settle(key, a.store.SaveGrant(pending.resource, pending.grant(token)))
		return
	}
}

package api

import (
	"context"
	"os"
	"strings"
	"testing"
)

type fakeStore struct {
	available bool
	values    map[string]string
}

func (s *fakeStore) Available() bool { return s.available }

func (s *fakeStore) Get(name string) (string, bool) {
	value, ok := s.values[name]
	return value, ok
}

func (s *fakeStore) Set(name string, value string) error {
	if s.values == nil {
		s.values = map[string]string{}
	}
	s.values[name] = value
	return nil
}

func (s *fakeStore) Delete(name string) error {
	delete(s.values, name)
	return nil
}

func statusFor(t *testing.T, resolver *Resolver, name string) *VariableStatus {
	t.Helper()
	for _, status := range resolver.Statuses() {
		if status.Name == name {
			return status
		}
	}
	t.Fatalf("no status reported for %q", name)
	return nil
}

func TestResolveLiteralValue(t *testing.T) {
	resolver := NewResolver(map[string]string{"API_BASE_URL": "https://api.example.com"}, nil)

	if got := resolver.Expand("${API_BASE_URL}/v1"); got != "https://api.example.com/v1" {
		t.Errorf("expected the literal value to expand, got %q", got)
	}
	if got := statusFor(t, resolver, "API_BASE_URL").Source; got != VariableSource_VARIABLE_SOURCE_FILE {
		t.Errorf("expected source FILE, got %v", got)
	}
	// A value kaja.json carries is not hidden, so it is never masked back out.
	headers := resolver.Redact(map[string]string{"X-Base": "https://api.example.com"}, nil)
	if headers["X-Base"] != "https://api.example.com" {
		t.Errorf("expected a literal value to survive redaction, got %q", headers["X-Base"])
	}
}

// The store wins over the environment: on the desktop the app is where the value
// was typed, and an inherited KAJA_<NAME> should not silently override it.
func TestResolveSecretPrefersStoreOverEnvironment(t *testing.T) {
	t.Setenv("KAJA_TOKEN", "from-environment")
	store := &fakeStore{available: true, values: map[string]string{"TOKEN": "from-keychain"}}

	resolver := NewResolver(map[string]string{"TOKEN": "${secret}"}, store)

	if got := resolver.Expand("Bearer ${TOKEN}"); got != "Bearer from-keychain" {
		t.Errorf("expected the stored value, got %q", got)
	}
	status := statusFor(t, resolver, "TOKEN")
	if status.Source != VariableSource_VARIABLE_SOURCE_KEYCHAIN {
		t.Errorf("expected source KEYCHAIN, got %v", status.Source)
	}
	if status.EnvName != "KAJA_TOKEN" {
		t.Errorf("expected the fallback env name to be reported, got %q", status.EnvName)
	}
}

func TestResolveSecretFallsBackToEnvironment(t *testing.T) {
	t.Setenv("KAJA_TOKEN", "from-environment")

	for _, store := range []VariableStore{nil, &fakeStore{available: false, values: map[string]string{"TOKEN": "unreachable"}}} {
		resolver := NewResolver(map[string]string{"TOKEN": "${secret}"}, store)

		if got := resolver.Expand("Bearer ${TOKEN}"); got != "Bearer from-environment" {
			t.Errorf("expected the environment value, got %q", got)
		}
		if got := statusFor(t, resolver, "TOKEN").Source; got != VariableSource_VARIABLE_SOURCE_ENVIRONMENT {
			t.Errorf("expected source ENVIRONMENT, got %v", got)
		}
	}
}

// A variable whose source holds nothing is not defined at all, so ${NAME} passes
// through literally - which is what the Variables tab tells the user happens.
func TestResolveUnsetSecretLeavesTheReference(t *testing.T) {
	resolver := NewResolver(map[string]string{"TOKEN": "${secret}"}, &fakeStore{available: true})

	if got := resolver.Expand("Bearer ${TOKEN}"); got != "Bearer ${TOKEN}" {
		t.Errorf("expected the reference to pass through, got %q", got)
	}
	if got := statusFor(t, resolver, "TOKEN").Source; got != VariableSource_VARIABLE_SOURCE_UNSET {
		t.Errorf("expected source UNSET, got %v", got)
	}
	if _, ok := resolver.Values()["TOKEN"]; ok {
		t.Error("expected an unset variable to have no value")
	}
}

func TestResolveEnvironmentReference(t *testing.T) {
	t.Setenv("SERVICE_HOST", "api.example.com")
	resolver := NewResolver(map[string]string{
		"API_BASE_URL": "https://${env:SERVICE_HOST}/v1",
		"GH_TOKEN":     "${env:GITHUB_TOKEN}",
	}, nil)

	if got := resolver.Expand("${API_BASE_URL}"); got != "https://api.example.com/v1" {
		t.Errorf("expected the embedded reference to expand, got %q", got)
	}
	status := statusFor(t, resolver, "API_BASE_URL")
	if status.Source != VariableSource_VARIABLE_SOURCE_ENVIRONMENT || status.EnvName != "SERVICE_HOST" {
		t.Errorf("expected ENVIRONMENT/SERVICE_HOST, got %v/%q", status.Source, status.EnvName)
	}

	// GITHUB_TOKEN isn't set, so the variable never resolved.
	if got := resolver.Expand("${GH_TOKEN}"); got != "${GH_TOKEN}" {
		t.Errorf("expected the reference to pass through, got %q", got)
	}
	if got := statusFor(t, resolver, "GH_TOKEN"); got.Source != VariableSource_VARIABLE_SOURCE_UNSET || got.EnvName != "GITHUB_TOKEN" {
		t.Errorf("expected UNSET/GITHUB_TOKEN, got %v/%q", got.Source, got.EnvName)
	}
}

// A value kaja.json doesn't carry must not come back to the UI through the
// headers an app reports exchanging with its upstream. A header the app
// synthesized from its own credentials is masked by content.
func TestRedactMasksResolvedValues(t *testing.T) {
	t.Setenv("KAJA_TOKEN", "super-secret-value")
	resolver := NewResolver(map[string]string{"TOKEN": "${secret}", "PLAIN": "not-a-secret"}, nil)

	redacted := resolver.Redact(map[string]string{
		"Authorization": "Bearer super-secret-value",
		"X-Plain":       "not-a-secret",
	}, nil)

	if redacted["Authorization"] != "Bearer ${TOKEN}" {
		t.Errorf("expected the resolved value to be masked, got %q", redacted["Authorization"])
	}
	if redacted["X-Plain"] != "not-a-secret" {
		t.Errorf("expected a literal value to survive redaction, got %q", redacted["X-Plain"])
	}
}

// A header the client sent is restored to exactly what it wrote, so a short
// stored value can't corrupt unrelated text by matching a substring of it.
func TestRedactRestoresSentHeaders(t *testing.T) {
	t.Setenv("KAJA_SHORT", "secret")
	resolver := NewResolver(map[string]string{"SHORT": "${secret}"}, nil)

	sent := map[string]string{"Authorization": "Bearer ${SHORT}", "X-Plain": "not-a-secret"}
	redacted := resolver.Redact(resolver.ExpandAll(sent), sent)

	if redacted["Authorization"] != "Bearer ${SHORT}" {
		t.Errorf("expected the sent header to be restored, got %q", redacted["Authorization"])
	}
	if redacted["X-Plain"] != "not-a-secret" {
		t.Errorf("expected an unreferenced header to survive redaction, got %q", redacted["X-Plain"])
	}
}

func TestExpandAllHeaders(t *testing.T) {
	t.Setenv("KAJA_TOKEN", "super-secret")
	resolver := NewResolver(map[string]string{"TOKEN": "${secret}"}, nil)

	expanded := resolver.ExpandAll(map[string]string{"Authorization": "Bearer ${TOKEN}", "X-Plain": "as-is"})

	if expanded["Authorization"] != "Bearer super-secret" {
		t.Errorf("expected the header to expand, got %q", expanded["Authorization"])
	}
	if expanded["X-Plain"] != "as-is" {
		t.Errorf("expected an unreferenced header to be untouched, got %q", expanded["X-Plain"])
	}
}

// The response the UI reads carries kaja.json's own text - the source, not what
// it resolved to. This is the invariant the whole design rests on.
func TestGetConfigurationSendsNoResolvedValues(t *testing.T) {
	t.Setenv("KAJA_TOKEN", "super-secret-value")
	t.Setenv("SERVICE_HOST", "api.example.com")

	tmpfile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpfile.Name())
	if _, err := tmpfile.Write([]byte(`{"variables":{"TOKEN":"${secret}","API_BASE_URL":"https://${env:SERVICE_HOST}/v1","PLAIN":"literal"}}`)); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	service := NewApiService(tmpfile.Name(), false, "", "", nil)
	response, err := service.GetConfiguration(context.Background(), &GetConfigurationRequest{})
	if err != nil {
		t.Fatalf("failed to get configuration: %v", err)
	}

	variables := response.Configuration.Variables
	if variables["TOKEN"] != "${secret}" {
		t.Errorf("expected the source to travel, got %q", variables["TOKEN"])
	}
	if variables["API_BASE_URL"] != "https://${env:SERVICE_HOST}/v1" {
		t.Errorf("expected the source to travel, got %q", variables["API_BASE_URL"])
	}
	if variables["PLAIN"] != "literal" {
		t.Errorf("expected a literal value to travel, got %q", variables["PLAIN"])
	}

	sources := map[string]VariableSource{}
	for _, status := range response.VariableStatus {
		sources[status.Name] = status.Source
	}
	if sources["TOKEN"] != VariableSource_VARIABLE_SOURCE_ENVIRONMENT {
		t.Errorf("expected TOKEN to report ENVIRONMENT, got %v", sources["TOKEN"])
	}
	if sources["PLAIN"] != VariableSource_VARIABLE_SOURCE_FILE {
		t.Errorf("expected PLAIN to report FILE, got %v", sources["PLAIN"])
	}
	if response.Runtime.VariableStoreAvailable {
		t.Error("expected no variable store without one bound")
	}
}

func TestSetStoredValueRejectedWithoutAStore(t *testing.T) {
	tmpfile, err := os.CreateTemp("", "config-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpfile.Name())
	if _, err := tmpfile.Write([]byte("{}")); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	service := NewApiService(tmpfile.Name(), true, "", "", nil)
	_, err = service.SetStoredValue(context.Background(), &SetStoredValueRequest{Name: "TOKEN", Value: "x"})
	if err == nil || !strings.Contains(err.Error(), "KAJA_TOKEN") {
		t.Errorf("expected the error to name the environment variable to set instead, got %v", err)
	}

	// Clearing is a different matter: with no store there is nothing to clear,
	// and saving the Variables tab clears whatever stopped being stored either
	// way, so it has to succeed.
	if _, err := service.ClearStoredValue(context.Background(), &ClearStoredValueRequest{Name: "TOKEN"}); err != nil {
		t.Errorf("expected clearing without a store to succeed, got %v", err)
	}
}

func TestValidateVariables(t *testing.T) {
	if err := validateVariables(map[string]string{"API_BASE_URL": "https://api.example.com", "TOKEN": "${secret}"}); err != nil {
		t.Errorf("expected valid variables to pass, got %v", err)
	}

	err := validateVariables(map[string]string{"my-var": "value"})
	if err == nil || !strings.Contains(err.Error(), "my-var") {
		t.Errorf("expected a name that ${NAME} can't reference to be rejected, got %v", err)
	}

	err = validateVariables(map[string]string{"TOKEN": "Bearer ${secret}"})
	if err == nil || !strings.Contains(err.Error(), "whole value") {
		t.Errorf("expected an embedded ${secret} to be rejected, got %v", err)
	}
}

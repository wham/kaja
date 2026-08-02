package api

import (
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
)

// VariableStore holds variable values outside kaja.json - the OS keychain in the
// desktop app. A deployment without one (the web server) binds nothing, and a
// "${secret}" variable falls back to the environment.
type VariableStore interface {
	// Available reports whether the store can be used at all. A desktop with no
	// usable keyring binds a store that is simply unavailable.
	Available() bool
	Get(name string) (string, bool)
	Set(name string, value string) error
	Delete(name string) error
}

// secretSource is the whole value of a variable this machine holds the value
// for: the keychain, or KAJA_<NAME> in the environment.
const secretSource = "${secret}"

// envSourcePattern matches a ${env:X} reference, which may sit inside a longer
// value (e.g. "https://${env:HOST}/v1").
var envSourcePattern = regexp.MustCompile(`\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}`)

// storedEnvName is the environment variable a "${secret}" variable falls back
// to, so the same kaja.json works on a machine with no keychain.
func storedEnvName(name string) string {
	return "KAJA_" + name
}

// Resolver resolves the configured variables to the values ${NAME} references
// expand to. It also keeps the values that did not come from kaja.json, so they
// can be masked back out of anything reported to the UI.
type Resolver struct {
	values   map[string]string
	hidden   []hiddenValue
	statuses []*VariableStatus
}

// hiddenValue is a resolved value that is not written in kaja.json, paired with
// the reference it is masked back to.
type hiddenValue struct {
	name  string
	value string
}

// NewResolver resolves every configured variable once, against the given store
// and the process environment.
func NewResolver(variables map[string]string, store VariableStore) *Resolver {
	resolver := &Resolver{values: make(map[string]string, len(variables))}

	names := make([]string, 0, len(variables))
	for name := range variables {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		value, status := resolveVariable(name, variables[name], store)
		resolver.statuses = append(resolver.statuses, status)
		// A variable whose source holds nothing is not defined at all: ${NAME}
		// passes through literally, which is what the UI tells the user happens.
		if status.Source == VariableSource_VARIABLE_SOURCE_UNSET {
			continue
		}
		resolver.values[name] = value
		if status.Source != VariableSource_VARIABLE_SOURCE_FILE && value != "" {
			resolver.hidden = append(resolver.hidden, hiddenValue{name: name, value: value})
		}
	}

	// Longest first, so masking a value that contains another one doesn't leave
	// the shorter one's replacement embedded in it.
	sort.SliceStable(resolver.hidden, func(i, j int) bool {
		return len(resolver.hidden[i].value) > len(resolver.hidden[j].value)
	})

	return resolver
}

// resolveVariable resolves one variable's configured value: literal, the value
// this machine stores for it, or the environment variables it references.
func resolveVariable(name string, configured string, store VariableStore) (string, *VariableStatus) {
	if strings.TrimSpace(configured) == secretSource {
		envName := storedEnvName(name)
		if store != nil && store.Available() {
			if stored, ok := store.Get(name); ok {
				return stored, &VariableStatus{Name: name, Source: VariableSource_VARIABLE_SOURCE_KEYCHAIN, EnvName: envName}
			}
		}
		if fromEnv, ok := os.LookupEnv(envName); ok {
			return fromEnv, &VariableStatus{Name: name, Source: VariableSource_VARIABLE_SOURCE_ENVIRONMENT, EnvName: envName}
		}
		return "", &VariableStatus{Name: name, Source: VariableSource_VARIABLE_SOURCE_UNSET, EnvName: envName}
	}

	references := envSourcePattern.FindAllStringSubmatch(configured, -1)
	if len(references) == 0 {
		return configured, &VariableStatus{Name: name, Source: VariableSource_VARIABLE_SOURCE_FILE}
	}

	var missing []string
	expanded := envSourcePattern.ReplaceAllStringFunc(configured, func(reference string) string {
		envName := reference[len("${env:") : len(reference)-1]
		if fromEnv, ok := os.LookupEnv(envName); ok {
			return fromEnv
		}
		missing = append(missing, envName)
		return reference
	})

	if len(missing) > 0 {
		return "", &VariableStatus{Name: name, Source: VariableSource_VARIABLE_SOURCE_UNSET, EnvName: strings.Join(missing, ", ")}
	}
	return expanded, &VariableStatus{Name: name, Source: VariableSource_VARIABLE_SOURCE_ENVIRONMENT, EnvName: references[0][1]}
}

// Expand replaces ${NAME} references with the resolved variable values.
// References to variables that aren't configured are left as-is, so literal
// ${...} text still passes through.
func (r *Resolver) Expand(value string) string {
	return expandVariables(value, r.values)
}

// ExpandAll expands every value in a map, returning a new one. It is how the
// headers the client sends as ${NAME} become the headers the upstream sees.
func (r *Resolver) ExpandAll(values map[string]string) map[string]string {
	if len(values) == 0 {
		return values
	}
	expanded := make(map[string]string, len(values))
	for key, value := range values {
		expanded[key] = r.Expand(value)
	}
	return expanded
}

// maskableLength is how long a resolved value has to be before it is masked by
// content. Below it a value is indistinguishable from ordinary header text
// ("secret" inside "not-a-secret"), and masking it would corrupt what the user
// reads more often than it would hide anything. Headers the client sent are
// restored exactly and don't go through this.
const maskableLength = 8

// Redact masks resolved values that are not written in kaja.json back to their
// ${NAME} reference. Everything an app reports exchanging with its upstream goes
// through here, so a value the file doesn't carry never reaches the UI.
//
// sent is the header map the client sent, still unexpanded. A reported header
// that is one of those expanded is restored to exactly what the client wrote,
// which is both precise and the more readable form. Anything else - a header the
// app synthesized from its own credentials - is masked by content.
func (r *Resolver) Redact(reported map[string]string, sent map[string]string) map[string]string {
	if len(reported) == 0 || len(r.hidden) == 0 {
		return reported
	}
	redacted := make(map[string]string, len(reported))
	for key, value := range reported {
		if original, ok := sent[key]; ok && r.Expand(original) == value {
			redacted[key] = original
			continue
		}
		for _, hidden := range r.hidden {
			if len(hidden.value) < maskableLength {
				continue
			}
			value = strings.ReplaceAll(value, hidden.value, "${"+hidden.name+"}")
		}
		redacted[key] = value
	}
	return redacted
}

// Values returns every variable's resolved value. Only the desktop, whose UI
// runs inside this process, reads them - the web server sends the UI what
// kaja.json says and resolves everything else itself.
func (r *Resolver) Values() map[string]string {
	values := make(map[string]string, len(r.values))
	for name, value := range r.values {
		values[name] = value
	}
	return values
}

// Statuses reports where each variable's value came from, in name order.
func (r *Resolver) Statuses() []*VariableStatus {
	return r.statuses
}

// validateVariables reports the configured variables that can never resolve:
// names that ${NAME} can't reference, and a "${secret}" buried inside a longer
// value, which has nothing to say there because the store is keyed by the
// variable's own name.
func validateVariables(variables map[string]string) error {
	names := make([]string, 0, len(variables))
	for name := range variables {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		if !variableNamePattern.MatchString(name) {
			return fmt.Errorf("variable name %q must start with a letter or underscore and contain only letters, numbers and underscores", name)
		}
		value := variables[name]
		if strings.Contains(value, secretSource) && strings.TrimSpace(value) != secretSource {
			return fmt.Errorf("variable %q: %s must be the whole value", name, secretSource)
		}
	}
	return nil
}

var variableNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

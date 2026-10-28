package agent

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"google.golang.org/protobuf/reflect/protoreflect"

	"github.com/wham/kaja/v2/pkg/api"
	"github.com/wham/kaja/v2/pkg/mcp"
)

// Apps is the workspace's apps as the process holding kaja.json reads and writes them.
// An agent describes an app in the file's own vocabulary and this is where that
// description is probed, with the same Inspect calls the window's forms make, and
// where it is written, through the same UpdateWorkspace the window's form submits -
// so the window's watch stream sees the write and compiles the app as if a person
// had added it.
type Apps interface {
	Inspect(ctx context.Context, draft mcp.AppDraft) (mcp.AppInspection, error)
	Add(ctx context.Context, draft mcp.AppDraft) error
}

type workspaceApps struct{ service *api.ApiService }

// NewWorkspaceApps is the Apps both builds serve.
func NewWorkspaceApps(service *api.ApiService) Apps {
	return &workspaceApps{service: service}
}

var variableReference = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}`)

func (w *workspaceApps) Inspect(ctx context.Context, draft mcp.AppDraft) (mcp.AppInspection, error) {
	app, err := buildWorkspaceApp(draft)
	if err != nil {
		return mcp.AppInspection{}, err
	}
	response, err := w.service.GetWorkspace(ctx, &api.GetWorkspaceRequest{})
	if err != nil {
		return mcp.AppInspection{}, err
	}
	if draft.Name != "" && hasApp(response.Workspace, draft.Name) {
		return mcp.AppInspection{}, fmt.Errorf("an app named %q is already in the workspace; pick another name", draft.Name)
	}

	// A reference nothing resolves would be sent literally, so the probe is not made
	// until it would mean something.
	if missing := undefinedVariables(draft, response); len(missing) > 0 {
		return mcp.AppInspection{Summary: "Not probed: a variable it names has no value here.", Missing: missing, Settled: draft}, nil
	}

	inspection := mcp.AppInspection{Settled: draft}
	switch draft.Type {
	case "grpc":
		err = w.inspectGrpc(ctx, app.GetGrpc(), &inspection)
	case "openapi":
		err = w.inspectOpenApi(ctx, app.GetOpenapi(), &inspection)
	case "mcp":
		err = w.inspectMcp(ctx, app.GetMcp(), &inspection)
	case "twirp":
		err = w.inspectTwirp(app.GetTwirp(), &inspection)
	case "openai":
		inspectOpenAi(app.GetOpenai(), &inspection)
	case "folder":
		inspectFolder(app.GetFolder(), &inspection)
	}
	if err != nil {
		return mcp.AppInspection{}, err
	}
	inspection.Settled = settledDraft(draft, app)
	return inspection, nil
}

func (w *workspaceApps) inspectGrpc(ctx context.Context, grpc *api.GrpcApp, inspection *mcp.AppInspection) error {
	if grpc.Url == "" {
		return errors.New("a grpc app needs url, e.g. dns:api.example.com:443")
	}
	if grpc.ProtoDir == "" {
		grpc.Reflection = true
	}
	response, err := w.service.InspectGrpc(ctx, &api.InspectGrpcRequest{Grpc: grpc})
	if err != nil {
		return err
	}
	if problem := response.Problem; problem != nil {
		switch problem.Kind {
		case api.GrpcProblemKind_GRPC_PROBLEM_UNAUTHENTICATED:
			if grpc.Auth == "" {
				grpc.Auth = "bearer"
			}
			inspection.Missing = append(inspection.Missing, "A credential: "+problem.Message+" auth is bearer unless the server says otherwise; the token goes in token.")
		case api.GrpcProblemKind_GRPC_PROBLEM_PERMISSION_DENIED:
			inspection.Missing = append(inspection.Missing, "A credential the server accepts: "+problem.Message)
		case api.GrpcProblemKind_GRPC_PROBLEM_NO_REFLECTION:
			inspection.Missing = append(inspection.Missing, "A proto folder: the server has no reflection, so proto_dir has to name a folder of .proto files inside the workspace.")
		default:
			inspection.Problem = problemText(problem.Message, problem.Detail)
		}
		inspection.Summary = fmt.Sprintf("%s did not answer with its surface.", grpc.Url)
		return nil
	}
	server := response.Server
	if grpc.Tls == "" && server.Reachable {
		grpc.Tls = "off"
		if server.Tls {
			grpc.Tls = "on"
		}
	}
	names := make([]string, 0, len(server.Services))
	for _, service := range server.Services {
		names = append(names, service.Name)
	}
	source := "reflection " + server.ReflectionVersion
	if server.Source != "reflection" {
		source = fmt.Sprintf("%d proto files in %s", server.FileCount, grpc.ProtoDir)
	}
	inspection.Summary = fmt.Sprintf("%s answered over %s: %s, %d methods. Services: %s.", grpc.Url, source, count(len(server.Services), "service"), server.MethodCount, strings.Join(names, ", "))
	return nil
}

func (w *workspaceApps) inspectOpenApi(ctx context.Context, openapi *api.OpenApiApp, inspection *mcp.AppInspection) error {
	if openapi.SpecUrl == "" && openapi.SpecContent == "" {
		return errors.New("an openapi app needs spec_url (the document's address) or spec_content (the document itself)")
	}
	response, err := w.service.InspectOpenApi(ctx, &api.InspectOpenApiRequest{Openapi: openapi})
	if err != nil {
		return err
	}
	if problem := response.Problem; problem != nil {
		if problem.Kind == api.OpenApiProblemKind_OPEN_API_PROBLEM_UNAUTHORIZED {
			inspection.Missing = append(inspection.Missing, "The document's own credential: "+problem.Message+" It goes in spec_header_name and spec_header_value, apart from the API's.")
			inspection.Summary = fmt.Sprintf("%s did not hand over its document.", openapi.SpecUrl)
			return nil
		}
		inspection.Problem = problemText(problem.Message, problem.Detail)
		return nil
	}
	document := response.Document
	inspection.Summary = fmt.Sprintf("%s %s (OpenAPI %s): %s.", document.Title, document.Version, document.OpenapiVersion, count(int(document.OperationCount), "operation"))

	if openapi.BaseUrl == "" {
		switch len(document.Servers) {
		case 0:
			if document.GuessedBaseUrl == "" {
				inspection.Missing = append(inspection.Missing, "A base_url: the document names no server and was not read from one.")
			}
		case 1:
			if variables := undefaultedVariables(document.Servers[0]); len(variables) > 0 {
				inspection.Missing = append(inspection.Missing, fmt.Sprintf("Values for the server URL's variables (%s): write the server out as base_url.", strings.Join(variables, ", ")))
			}
		default:
			servers := make([]string, 0, len(document.Servers))
			for _, server := range document.Servers {
				servers = append(servers, describeServer(server))
			}
			inspection.Missing = append(inspection.Missing, "Which server: base_url is one of "+strings.Join(servers, "; ")+".")
		}
	}

	if openapi.SecurityScheme != "" && openapi.SecurityScheme != "none" {
		known := false
		for _, scheme := range document.SecuritySchemes {
			known = known || scheme.Key == openapi.SecurityScheme
		}
		if !known {
			inspection.Problem = fmt.Sprintf("the document declares no security scheme %q; it declares %s", openapi.SecurityScheme, strings.Join(schemeKeys(document.SecuritySchemes), ", "))
			return nil
		}
	}
	credential := openapi.Token != "" || openapi.Username != "" || openapi.Password != ""
	if len(document.SecuritySchemes) > 0 && openapi.SecurityScheme != "none" && !credential {
		schemes := make([]string, 0, len(document.SecuritySchemes))
		for _, scheme := range document.SecuritySchemes {
			schemes = append(schemes, describeScheme(scheme))
		}
		inspection.Missing = append(inspection.Missing, "A credential: the document declares "+strings.Join(schemes, "; ")+
			". Set security_scheme to one of the keys and give token, or username and password.")
	}
	return nil
}

func (w *workspaceApps) inspectMcp(ctx context.Context, server *api.McpApp, inspection *mcp.AppInspection) error {
	if server.Url == "" {
		return errors.New("an mcp app needs url, the server's Streamable HTTP endpoint")
	}
	response, err := w.service.InspectMcp(ctx, &api.InspectMcpRequest{Mcp: server})
	if err != nil {
		return err
	}
	if problem := response.Problem; problem != nil {
		switch problem.Kind {
		case api.McpProblemKind_MCP_PROBLEM_UNAUTHORIZED:
			inspection.Missing = append(inspection.Missing, "A credential: "+problem.Message+" auth is bearer by default; oauth is where Kaja signs in itself.")
		case api.McpProblemKind_MCP_PROBLEM_FORBIDDEN:
			inspection.Missing = append(inspection.Missing, "A credential the server accepts: "+problem.Message)
		case api.McpProblemKind_MCP_PROBLEM_SIGN_IN, api.McpProblemKind_MCP_PROBLEM_AUTHORIZATION:
			inspection.Missing = append(inspection.Missing, "Signing in: the app uses OAuth and Kaja has not signed in to this server yet. "+problem.Message)
		default:
			inspection.Problem = problemText(problem.Message, problem.Detail)
		}
		inspection.Summary = fmt.Sprintf("%s did not answer with its surface.", server.Url)
		return nil
	}
	surface := response.Server
	inspection.Summary = fmt.Sprintf("%s %s (MCP %s): %s, %s, %s.", surface.Name, surface.Version, surface.ProtocolVersion,
		count(int(surface.ToolCount), "tool"), count(int(surface.ResourceCount+surface.ResourceTemplateCount), "resource"), count(int(surface.PromptCount), "prompt"))
	return nil
}

func (w *workspaceApps) inspectTwirp(twirp *api.TwirpApp, inspection *mcp.AppInspection) error {
	if twirp.Url == "" {
		return errors.New("a twirp app needs url")
	}
	if twirp.ProtoDir == "" {
		inspection.Missing = append(inspection.Missing, "A proto folder: a Twirp server declares nothing about itself, so proto_dir has to name a folder of .proto files inside the workspace.")
		inspection.Summary = fmt.Sprintf("Twirp at %s; nothing was probed, a Twirp server declaring nothing.", twirp.Url)
		return nil
	}
	dir := twirp.ProtoDir
	if !filepath.IsAbs(dir) {
		dir = filepath.Join(w.service.WorkspaceDir(), dir)
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		inspection.Problem = fmt.Sprintf("proto_dir %q is not a folder in the workspace", twirp.ProtoDir)
		return nil
	}
	inspection.Summary = fmt.Sprintf("Twirp at %s, protos from %s. Nothing was probed, a Twirp server declaring nothing about itself.", twirp.Url, twirp.ProtoDir)
	return nil
}

func inspectOpenAi(chat *api.OpenAiApp, inspection *mcp.AppInspection) {
	if chat.Api == "" {
		chat.Api = "openai"
	}
	if chat.Token == "" && chat.Auth != "none" {
		inspection.Missing = append(inspection.Missing, "A token: the key the chat API's own dashboard hands out.")
	}
	endpoint := chat.Endpoint
	if endpoint == "" {
		endpoint = "the API's default endpoint"
	}
	inspection.Summary = fmt.Sprintf("A chat model at %s, spoken as %s. A chat endpoint declares nothing, so nothing was probed.", endpoint, chat.Api)
}

func inspectFolder(folder *api.FolderApp, inspection *mcp.AppInspection) {
	if folder.Path == "" {
		inspection.Missing = append(inspection.Missing, "The folder: on the desktop it has to be picked in the form, because a typed path grants a sandboxed Kaja no access to it.")
		inspection.Summary = "A folder on this machine."
		return
	}
	inspection.Summary = fmt.Sprintf("The folder %s.", folder.Path)
}

// Add writes the app as one edit of kaja.json, read and written under the service's
// write lock, so an app added while the window is saving something else lands beside
// it rather than over it.
func (w *workspaceApps) Add(ctx context.Context, draft mcp.AppDraft) error {
	app, err := buildWorkspaceApp(draft)
	if err != nil {
		return err
	}
	return w.service.MutateWorkspace(func(workspace *api.Workspace) error {
		if hasApp(workspace, draft.Name) {
			return fmt.Errorf("an app named %q is already in the workspace; pick another name", draft.Name)
		}
		workspace.Apps = append(workspace.Apps, app)
		return nil
	})
}

// buildWorkspaceApp reads a draft into the typed message by the proto's own field
// names, so an agent writes exactly what kaja.json would say and a key the type has
// not got is refused naming the ones it has.
func buildWorkspaceApp(draft mcp.AppDraft) (*api.WorkspaceApp, error) {
	app := &api.WorkspaceApp{Name: draft.Name}
	message := app.ProtoReflect()
	oneof := message.Descriptor().Oneofs().ByName("app")
	types := make([]string, 0, oneof.Fields().Len())
	for i := 0; i < oneof.Fields().Len(); i++ {
		types = append(types, string(oneof.Fields().Get(i).Name()))
	}
	if draft.Type == "" {
		return nil, fmt.Errorf("provide type: one of %s", strings.Join(types, ", "))
	}
	field := oneof.Fields().ByName(protoreflect.Name(draft.Type))
	if field == nil {
		return nil, fmt.Errorf("no app type %q; one of %s", draft.Type, strings.Join(types, ", "))
	}
	variant := message.Mutable(field).Message()
	fields := variant.Descriptor().Fields()

	keys := make([]string, 0, len(draft.Parameters))
	for key := range draft.Parameters {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		f := fields.ByName(protoreflect.Name(key))
		if f == nil || f.IsMap() {
			return nil, fmt.Errorf("a %s app has no parameter %q; its parameters are %s", draft.Type, key, strings.Join(parameterNames(fields), ", "))
		}
		value := draft.Parameters[key]
		switch f.Kind() {
		case protoreflect.BoolKind:
			enabled, err := strconv.ParseBool(strings.TrimSpace(value))
			if err != nil {
				return nil, fmt.Errorf("%s is true or false, not %q", key, value)
			}
			variant.Set(f, protoreflect.ValueOfBool(enabled))
		case protoreflect.StringKind:
			variant.Set(f, protoreflect.ValueOfString(value))
		default:
			return nil, fmt.Errorf("%s cannot be set from a string", key)
		}
	}
	if len(draft.Headers) > 0 {
		f := fields.ByName("headers")
		if f == nil {
			return nil, fmt.Errorf("a %s app sends no headers", draft.Type)
		}
		headers := variant.Mutable(f).Map()
		for name, value := range draft.Headers {
			headers.Set(protoreflect.ValueOfString(name).MapKey(), protoreflect.ValueOfString(value))
		}
	}
	return app, nil
}

// settledDraft is the draft read back off the message after a probe wrote into it,
// so what the form is prefilled with and what is written is what the probe settled.
func settledDraft(draft mcp.AppDraft, app *api.WorkspaceApp) mcp.AppDraft {
	settled := mcp.AppDraft{Name: draft.Name, Type: draft.Type, Parameters: map[string]string{}, Headers: draft.Headers, Hints: draft.Hints, Agent: draft.Agent}
	message := app.ProtoReflect()
	field := message.WhichOneof(message.Descriptor().Oneofs().ByName("app"))
	if field == nil {
		return settled
	}
	message.Get(field).Message().Range(func(f protoreflect.FieldDescriptor, v protoreflect.Value) bool {
		if f.IsMap() {
			return true
		}
		if f.Kind() == protoreflect.BoolKind {
			settled.Parameters[string(f.Name())] = strconv.FormatBool(v.Bool())
		} else {
			settled.Parameters[string(f.Name())] = v.String()
		}
		return true
	})
	return settled
}

func parameterNames(fields protoreflect.FieldDescriptors) []string {
	names := make([]string, 0, fields.Len())
	for i := 0; i < fields.Len(); i++ {
		if f := fields.Get(i); !f.IsMap() {
			names = append(names, string(f.Name()))
		}
	}
	return names
}

func hasApp(workspace *api.Workspace, name string) bool {
	if workspace == nil {
		return false
	}
	for _, app := range workspace.Apps {
		if app.Name == name {
			return true
		}
	}
	return false
}

// undefinedVariables is every `${NAME}` the draft writes that would be sent as it is:
// a name the workspace does not define, or one whose value this machine has not got.
func undefinedVariables(draft mcp.AppDraft, response *api.GetWorkspaceResponse) []string {
	defined := map[string]bool{}
	if response.Workspace != nil {
		for name := range response.Workspace.Variables {
			defined[name] = true
		}
	}
	unset := map[string]bool{}
	for _, status := range response.VariableStatus {
		if status.Source == api.VariableSource_VARIABLE_SOURCE_UNSET {
			unset[status.Name] = true
		}
	}
	values := make([]string, 0, len(draft.Parameters)+len(draft.Headers))
	for _, value := range draft.Parameters {
		values = append(values, value)
	}
	for _, value := range draft.Headers {
		values = append(values, value)
	}
	seen := map[string]bool{}
	var missing []string
	for _, value := range values {
		for _, match := range variableReference.FindAllStringSubmatch(value, -1) {
			name := match[1]
			if seen[name] {
				continue
			}
			seen[name] = true
			switch {
			case !defined[name]:
				missing = append(missing, fmt.Sprintf("The variable %s: `${%s}` names no variable in this workspace. It is defined under Variables, as ${secret} for a token.", name, name))
			case unset[name]:
				missing = append(missing, fmt.Sprintf("A value for the variable %s: it is defined but holds nothing on this machine, so the app would open without it.", name))
			}
		}
	}
	sort.Strings(missing)
	return missing
}

func undefaultedVariables(server *api.OpenApiServer) []string {
	var names []string
	for _, variable := range server.Variables {
		if variable.DefaultValue == "" {
			names = append(names, variable.Name)
		}
	}
	return names
}

func describeServer(server *api.OpenApiServer) string {
	if server.Description == "" {
		return server.Url
	}
	return fmt.Sprintf("%s (%s)", server.Url, server.Description)
}

func describeScheme(scheme *api.OpenApiSecurityScheme) string {
	var where string
	switch scheme.Type {
	case "apiKey":
		where = fmt.Sprintf("%s %s", scheme.In, scheme.ParameterName)
	case "http":
		where = "HTTP " + scheme.Scheme
	default:
		where = scheme.Type
	}
	return fmt.Sprintf("%s (%s)", scheme.Key, where)
}

func schemeKeys(schemes []*api.OpenApiSecurityScheme) []string {
	keys := make([]string, 0, len(schemes))
	for _, scheme := range schemes {
		keys = append(keys, scheme.Key)
	}
	return keys
}

func problemText(message, detail string) string {
	if detail == "" {
		return message
	}
	return message + " (" + detail + ")"
}

func count(n int, noun string) string {
	if n == 1 {
		return "1 " + noun
	}
	return fmt.Sprintf("%d %ss", n, noun)
}

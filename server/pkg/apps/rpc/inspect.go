package rpc

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/wham/kaja/v2/internal/workspace"
	"github.com/wham/kaja/v2/pkg/grpc"
	"github.com/wham/protoc-go/protoc"
	grpccodes "google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/descriptorpb"
)

// Where a surface came from.
const (
	SourceReflection = "reflection"
	SourceProtoDir   = "proto_dir"
)

// Server is what a gRPC app's surface turned out to be: the services it exposes,
// and how kaja reached them.
type Server struct {
	Source            string
	Target            string
	TLS               bool
	Reachable         bool
	Services          []Service
	MethodCount       int
	ReflectionVersion string
	FileCount         int
	ProtoDir          string
}

// Service is one service in that surface.
type Service struct {
	Name                 string
	MethodCount          int
	StreamingMethodCount int
}

// Problem is a surface that couldn't be read, classified so the form can name
// the next move rather than print the error and leave it there.
type Problem struct {
	Kind    string
	Message string
	Detail  string
}

// The problem kinds. The strings match the enum the API service maps them onto.
const (
	ProblemUnknown          = "unknown"
	ProblemUnreachable      = "unreachable"
	ProblemTLS              = "tls"
	ProblemNoReflection     = "noReflection"
	ProblemUnauthenticated  = "unauthenticated"
	ProblemPermissionDenied = "permissionDenied"
	ProblemNoServices       = "noServices"
	ProblemTimeout          = "timeout"
	ProblemNoProtoFiles     = "noProtoFiles"
	ProblemProtoInvalid     = "protoInvalid"
	ProblemTarget           = "target"
)

// How long one connection attempt may take. Reflection is the answer the form is
// waiting for, so it is given room; the probe is a nicety on top of proto files
// that have already been read, so it is not allowed to hold the form up.
const (
	reflectTimeout = 8 * time.Second
	probeTimeout   = 3 * time.Second
)

// Inspect reads the surface a gRPC app would be opened with, without opening it:
// it reflects the server, or reads the proto directory, and reports what it
// found. Parameters are the app's own, already expanded, credentials included -
// a server that guards reflection wants them before it will say anything.
func Inspect(parameters map[string]string, log func(string)) (*Server, *Problem) {
	if strings.TrimSpace(parameters["reflection"]) == "true" {
		return inspectReflection(parameters, log)
	}
	return inspectProtoDir(parameters, log)
}

func inspectReflection(parameters map[string]string, log func(string)) (*Server, *Problem) {
	target, problem := parseTarget(parameters["url"])
	if problem != nil {
		return nil, problem
	}

	options := TLS(parameters)
	metadata := Metadata(parameters)

	result, usedTLS, err := discover(target, options, metadata, reflectTimeout, log)
	if err != nil {
		// An app that pins the transport is taken at its word, so the other one is
		// never tried behind its back - but it is the single most likely reason a
		// live server reads as an unreachable one, so it is worth asking in order
		// to say so.
		if options.Mode != "" && worthRetrying(err) {
			if _, reachable := probe(target, options.WithMode(otherMode(options.Mode)), metadata, log); reachable {
				return nil, &Problem{Kind: ProblemTLS, Message: wrongTransport(options.Mode), Detail: err.Error()}
			}
		}
		return nil, classify(err)
	}
	if len(result.Services) == 0 {
		return nil, &Problem{
			Kind:    ProblemNoServices,
			Message: "The server reflects, but declares no services of its own.",
			Detail:  "Only the reflection service answered. There is nothing for kaja to generate.",
		}
	}

	server := &Server{
		Source:            SourceReflection,
		Target:            grpc.ToGRPCTarget(target),
		TLS:               usedTLS,
		Reachable:         true,
		ReflectionVersion: result.Version,
	}
	describe(server, result.FileDescriptors, result.Services)
	return server, nil
}

func inspectProtoDir(parameters map[string]string, log func(string)) (*Server, *Problem) {
	dir := strings.TrimSpace(parameters["proto_dir"])
	if dir == "" {
		return nil, &Problem{
			Kind:    ProblemNoProtoFiles,
			Message: "Point at a folder of .proto files.",
			Detail:  "Or switch to reflection and let the server describe itself.",
		}
	}

	resolved := workspace.Resolve(dir)
	files, err := protoFiles(resolved)
	if err != nil || len(files) == 0 {
		detail := fmt.Sprintf("Looked in %s", resolved)
		if err != nil {
			detail = err.Error()
		}
		return nil, &Problem{Kind: ProblemNoProtoFiles, Message: "No .proto files in that folder.", Detail: detail}
	}
	log(fmt.Sprintf("Found %d proto file(s) in %s", len(files), resolved))

	compiled, err := protoc.New(protoc.WithProtoPaths(resolved)).Compile(files...)
	if err != nil {
		return nil, &Problem{Kind: ProblemProtoInvalid, Message: "The proto files are there, but they don't compile.", Detail: err.Error()}
	}

	server := &Server{Source: SourceProtoDir, FileCount: len(files), ProtoDir: resolved}
	describe(server, compiled.Files, nil)
	if len(server.Services) == 0 {
		return nil, &Problem{
			Kind:    ProblemNoProtoFiles,
			Message: "Those proto files declare no services.",
			Detail:  fmt.Sprintf("%d file(s) compiled, none of them with a service in it.", len(files)),
		}
	}

	// The proto files settle what the app exposes; the server is still asked
	// whether it is there, and over which transport, because that is the other
	// half of what the form has to fill in. Nothing here is fatal - an app can be
	// configured before the service it calls is running.
	if target, problem := parseTarget(parameters["url"]); problem == nil {
		if usedTLS, reachable := probe(target, TLS(parameters), Metadata(parameters), log); reachable {
			server.Target = grpc.ToGRPCTarget(target)
			server.TLS = usedTLS
			server.Reachable = true
		}
	}
	return server, nil
}

// discover reflects the server, and when the app leaves the transport to the URL
// it settles the question by trying the other one. A server reached over the
// wrong transport fails in a way that reads like a network failure, which is the
// single most confusing thing about pointing kaja at a gRPC address.
func discover(target *url.URL, options grpc.TLSOptions, metadata map[string]string, timeout time.Duration, log func(string)) (*grpc.ReflectionResult, bool, error) {
	modes := []string{options.Mode}
	if options.Mode == "" {
		if options.UseTLS(target) {
			modes = []string{grpc.TLSOn, grpc.TLSOff}
		} else {
			modes = []string{grpc.TLSOff, grpc.TLSOn}
		}
	}

	var firstErr error
	for _, mode := range modes {
		usedTLS := mode == grpc.TLSOn
		log(fmt.Sprintf("Reflecting %s over %s", grpc.ToGRPCTarget(target), transportName(usedTLS)))

		client := grpc.NewReflectionClient(target, options.WithMode(mode), metadata)
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		result, err := client.Discover(ctx)
		cancel()
		if err == nil {
			return result, usedTLS, nil
		}
		if firstErr == nil {
			firstErr = err
		}
		if !worthRetrying(err) {
			return nil, usedTLS, err
		}
	}
	return nil, false, firstErr
}

// probe asks the server the same question discover does, but only to learn
// whether it is there and over which transport. A server that answers "no
// reflection here" - or asks for a credential - has answered.
func probe(target *url.URL, options grpc.TLSOptions, metadata map[string]string, log func(string)) (bool, bool) {
	if _, usedTLS, err := discover(target, options, metadata, probeTimeout, log); err == nil || answered(err) {
		return usedTLS, true
	}
	return false, false
}

// answered reports whether a failure came from the server rather than from
// reaching it.
func answered(err error) bool {
	switch grpcstatus.Code(err) {
	case grpccodes.Unimplemented, grpccodes.Unauthenticated, grpccodes.PermissionDenied:
		return true
	}
	return false
}

// worthRetrying reports whether a failure could be the transport rather than the
// server. A connection that was opened and then dropped, or a handshake that
// didn't take, is worth trying the other way round; a host that isn't there, or
// one that never answered, will say the same thing twice and would only double
// how long the form spends saying nothing.
func worthRetrying(err error) bool {
	if answered(err) || grpcstatus.Code(err) == grpccodes.DeadlineExceeded {
		return false
	}
	detail := strings.ToLower(err.Error())
	for _, marker := range settledMarkers {
		if strings.Contains(detail, marker) {
			return false
		}
	}
	return true
}

var settledMarkers = []string{"connection refused", "no such host", "i/o timeout", "deadline exceeded", "name resolver error", "canceled"}

func otherMode(mode string) string {
	if mode == grpc.TLSOn {
		return grpc.TLSOff
	}
	return grpc.TLSOn
}

func wrongTransport(mode string) string {
	if mode == grpc.TLSOn {
		return "The server is there, but it doesn't speak TLS."
	}
	return "The server is there, but it only speaks TLS."
}

func classify(err error) *Problem {
	detail := err.Error()
	switch grpcstatus.Code(err) {
	case grpccodes.Unimplemented:
		return &Problem{
			Kind:    ProblemNoReflection,
			Message: "The server answered, but doesn't serve the reflection API.",
			Detail:  detail,
		}
	case grpccodes.Unauthenticated:
		return &Problem{
			Kind:    ProblemUnauthenticated,
			Message: "The server wants a credential before it will list its services.",
			Detail:  detail,
		}
	case grpccodes.PermissionDenied:
		return &Problem{
			Kind:    ProblemPermissionDenied,
			Message: "The server refused the credential it was given.",
			Detail:  detail,
		}
	case grpccodes.DeadlineExceeded:
		return &Problem{
			Kind:    ProblemTimeout,
			Message: "The server didn't answer in time.",
			Detail:  detail,
		}
	}
	if looksLikeTLS(detail) {
		return &Problem{Kind: ProblemTLS, Message: "The TLS handshake failed.", Detail: detail}
	}
	return &Problem{Kind: ProblemUnreachable, Message: "Couldn't reach the server.", Detail: detail}
}

var tlsMarkers = []string{"tls:", "x509", "certificate", "handshake"}

func looksLikeTLS(detail string) bool {
	lowered := strings.ToLower(detail)
	for _, marker := range tlsMarkers {
		if strings.Contains(lowered, marker) {
			return true
		}
	}
	return false
}

func parseTarget(raw string) (*url.URL, *Problem) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, &Problem{Kind: ProblemTarget, Message: "Where is the server?", Detail: "kaja needs an address to dial."}
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return nil, &Problem{Kind: ProblemTarget, Message: "That isn't an address kaja can dial.", Detail: err.Error()}
	}
	if grpc.ToGRPCTarget(parsed) == "" {
		return nil, &Problem{Kind: ProblemTarget, Message: "That isn't an address kaja can dial.", Detail: trimmed}
	}
	return parsed, nil
}

func transportName(usedTLS bool) string {
	if usedTLS {
		return "TLS"
	}
	return "plaintext"
}

// describe counts up the services and methods in a set of file descriptors. When
// only is non-empty, only those fully qualified service names are counted, which
// is how a reflection result leaves out the reflection service itself.
func describe(server *Server, files []*descriptorpb.FileDescriptorProto, only []string) {
	wanted := map[string]bool{}
	for _, name := range only {
		wanted[name] = true
	}

	for _, file := range files {
		for _, service := range file.GetService() {
			name := service.GetName()
			if pkg := file.GetPackage(); pkg != "" {
				name = pkg + "." + name
			}
			if len(wanted) > 0 && !wanted[name] {
				continue
			}
			described := Service{Name: name, MethodCount: len(service.GetMethod())}
			for _, method := range service.GetMethod() {
				if method.GetClientStreaming() || method.GetServerStreaming() {
					described.StreamingMethodCount++
				}
			}
			server.Services = append(server.Services, described)
			server.MethodCount += described.MethodCount
		}
	}
	sort.Slice(server.Services, func(i, j int) bool { return server.Services[i].Name < server.Services[j].Name })
}

func protoFiles(dir string) ([]string, error) {
	var files []string
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && strings.EqualFold(filepath.Ext(path), ".proto") {
			relative, err := filepath.Rel(dir, path)
			if err != nil {
				return err
			}
			files = append(files, relative)
		}
		return nil
	})
	sort.Strings(files)
	return files, err
}

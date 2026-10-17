// Package kaja is protoc-gen-kaja, which turns a proto surface into what Kaja reads
// it by. An app compiles to a manifest (kaja_manifest): data the runtime builds its
// types from, and the declarations the editor and an agent read. Without the
// parameter each proto file becomes a TypeScript module, which is how Kaja's own Api
// is generated.
package kaja

import (
	"strings"

	"github.com/wham/protoc-go/protoc"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/pluginpb"
)

// NewPlugin returns the plugin for [protoc.Result.RunLibraryPlugin].
func NewPlugin() protoc.Plugin {
	return protoc.PluginFunc(Generate)
}

type params struct {
	manifest bool
}

func parseParameters(parameter string) params {
	p := params{}
	for _, name := range strings.Split(parameter, ",") {
		if strings.TrimSpace(name) == "kaja_manifest" {
			p.manifest = true
		}
	}
	return p
}

func Generate(req *pluginpb.CodeGeneratorRequest) (*pluginpb.CodeGeneratorResponse, error) {
	resp := &pluginpb.CodeGeneratorResponse{
		SupportedFeatures: proto.Uint64(uint64(pluginpb.CodeGeneratorResponse_FEATURE_PROTO3_OPTIONAL)),
	}
	s := newSchema(req.ProtoFile)
	var modules []*module
	for _, file := range s.moduleFiles(req.FileToGenerate) {
		modules = append(modules, newModule(s, file))
	}

	if parseParameters(req.GetParameter()).manifest {
		content, err := buildManifest(modules)
		if err != nil {
			return nil, err
		}
		resp.File = append(resp.File, &pluginpb.CodeGeneratorResponse_File{Name: proto.String(ManifestName), Content: proto.String(content)})
		return resp, nil
	}

	for _, m := range modules {
		resp.File = append(resp.File, &pluginpb.CodeGeneratorResponse_File{Name: proto.String(m.path), Content: proto.String(typescriptModule(m))})
	}
	return resp, nil
}

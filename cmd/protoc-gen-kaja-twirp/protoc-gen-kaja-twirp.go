package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"strconv"

	"github.com/wham/kaja-twirp/internal/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"google.golang.org/protobuf/types/pluginpb"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "%s: %v\n", filepath.Base(os.Args[0]), err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) > 1 {
		return fmt.Errorf("unknown argument %q (this program should be run by protoc, not directly)", os.Args[1])
	}
	in, err := ioutil.ReadAll(os.Stdin)
	if err != nil {
		return err
	}
	req := &pluginpb.CodeGeneratorRequest{}
	if err := proto.Unmarshal(in, req); err != nil {
		return err
	}
	content := files(req.ProtoFile)
	json, _ := json.MarshalIndent(content, "", " ")
	resp := &pluginpb.CodeGeneratorResponse{}
	resp.File = append(resp.File, &pluginpb.CodeGeneratorResponse_File{
		Name:    proto.String("kaja-twirp.json"),
		Content: proto.String(string(json)),
	})
	out, err := proto.Marshal(resp)
	if err != nil {
		return err
	}
	if _, err := os.Stdout.Write(out); err != nil {
		return err
	}
	return nil
}

func files(in []*descriptorpb.FileDescriptorProto) []model.File {
	out := []model.File{}
	reg := new(protoregistry.Files)

	for _, v := range in {
		r, _ := protodesc.NewFile(v, reg)
		if err := reg.RegisterFile(r); err != nil {
			// return nil, fmt.Errorf("cannot register descriptor %q: %v", p.GetName(), err)
			continue
		}
		out = append(out, file(r))
	}

	return out
}

func file(in protoreflect.FileDescriptor) model.File {
	return model.File{
		Path: in.Path(),
		Package: string(in.Package()),
		Services: services(in.Services()),
	}
}

func services(in protoreflect.ServiceDescriptors) []model.Service {
	out := []model.Service{}

	for i := 0; i < in.Len(); i++ {
		out = append(out, service(in.Get(i)))
	}

	return out
}

func service(in protoreflect.ServiceDescriptor) model.Service {
	out := model.Service{
		Name:  string(in.Name()),
		Methods: methods(in.Methods()),
	}

	return out
}

func methods(in protoreflect.MethodDescriptors) []model.Method {
	out := []model.Method{}

	for i := 0; i < in.Len(); i++ {
		out = append(out, method(in.Get(i)))
	}

	return out
}

func method(in protoreflect.MethodDescriptor) model.Method {
	out := model.Method{
		Name: string(in.Name()),
		Input:  message(in.Input()),
	}

	return out
}

func message(in protoreflect.MessageDescriptor) model.Message {
	out := model.Message{
		Fields: fields(in.Fields()),
	}

	return out
}

func fields(in protoreflect.FieldDescriptors) []model.Field {
	out := []model.Field{}

	for i := 0; i < in.Len(); i++ {
		out = append(out, field(in.Get(i)))
	}

	return out
}

func field(in protoreflect.FieldDescriptor) model.Field {
	out := model.Field{
		Name: string(in.Name()),
		Kind: in.Kind().String(),
	}

	o := getValue(in)
	m, _ := json.MarshalIndent(o, "", "  ")
	out.Value = string(m)

	if in.Kind() == protoreflect.EnumKind {
		out.Type = "select"
		out.Serialize = "int"
		out.Enums = map[string]string{}

		v := in.Enum().Values()

		for i := 0; i < v.Len(); i++ {
			k := v.Get(i)
			out.Enums[strconv.Itoa(int(k.Number()))] = string(k.Name())
		}
	} else if in.Kind() == protoreflect.MessageKind {
		if in.Message().FullName() == "google.protobuf.Timestamp" {
			out.Type = "text"
			out.Serialize = "text"
		} else if in.IsMap() {
			out.Type = "textarea"
			out.Serialize = "object"
		} else {
			out.Type = "textarea"
			out.Serialize = "object"
		}
	} else {
		out.Type = "text"
		out.Serialize = "text"
	}

	if in.Cardinality() == protoreflect.Repeated && !in.IsMap() {
		out.Type = "textarea"
		out.Serialize = "array"
	}

	return out
}

func getValue(in protoreflect.FieldDescriptor) any {
	if in.Cardinality() == protoreflect.Repeated && !in.IsMap() {
		return []any{
			getSingleValue(in),
		}
	}

	return getSingleValue(in)
}

func getSingleValue(in protoreflect.FieldDescriptor) any {
	if in.Kind() == protoreflect.EnumKind || isNumericKind(in.Kind()) {
		return 0
	} else if in.Kind() == protoreflect.MessageKind {
		if in.Message().FullName() == "google.protobuf.Timestamp" {
			return  "google.protobuf.Timestamp"
		} else if in.IsMap() {
			k := in.MapKey()
			v := in.MapValue()

			if isStringKind(k.Kind()) {
				return map[string]any{
					"key": getValue(v),
				}
			}

			if isNumericKind(k.Kind()) {
				return map[int]any{
					0: getValue(v),
				}
			}
		} else {
			message := in.Message()
			j := map[string]any{}
	
			for i := 0; i < message.Fields().Len(); i++ {
				f := message.Fields().Get(i)
				j[string(f.Name())] = getValue(f)
			}
	
			return j
		}
	}

	return ""
}


func isNumericKind(kind protoreflect.Kind) bool {
	return kind == protoreflect.Int32Kind ||
		kind == protoreflect.Sint32Kind ||
		kind == protoreflect.Uint32Kind ||
		kind == protoreflect.Int64Kind ||
		kind == protoreflect.Sint64Kind ||
		kind == protoreflect.Uint64Kind ||
		kind == protoreflect.Sfixed32Kind ||
		kind == protoreflect.Fixed32Kind ||
		kind == protoreflect.FloatKind ||
		kind == protoreflect.Sfixed64Kind ||
		kind == protoreflect.Fixed64Kind ||
		kind == protoreflect.DoubleKind
}

func isStringKind(kind protoreflect.Kind) bool {
	return kind == protoreflect.StringKind
}
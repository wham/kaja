package main

import (
	"io"
	"os"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/pluginpb"
)

func main() {
	input, err := io.ReadAll(os.Stdin)
	if err != nil {
		os.Stderr.WriteString("failed to read input: " + err.Error() + "\n")
		os.Exit(1)
	}

	req := &pluginpb.CodeGeneratorRequest{}
	if err := proto.Unmarshal(input, req); err != nil {
		os.Stderr.WriteString("failed to unmarshal request: " + err.Error() + "\n")
		os.Exit(1)
	}

	resp := generate(req)

	output, err := proto.Marshal(resp)
	if err != nil {
		os.Stderr.WriteString("failed to marshal response: " + err.Error() + "\n")
		os.Exit(1)
	}

	os.Stdout.Write(output)
}

func generate(req *pluginpb.CodeGeneratorRequest) *pluginpb.CodeGeneratorResponse {
	return &pluginpb.CodeGeneratorResponse{}
}

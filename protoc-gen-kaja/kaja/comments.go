package kaja

import (
	"fmt"
	"strings"

	"google.golang.org/protobuf/types/descriptorpb"
)

// comments are a file's comments by the path of what they are attached to.
type comments map[string]*descriptorpb.SourceCodeInfo_Location

func fileComments(file *descriptorpb.FileDescriptorProto) comments {
	c := comments{}
	for _, location := range file.GetSourceCodeInfo().GetLocation() {
		c[pathKey(location.Path)] = location
	}
	return c
}

func pathKey(path []int32) string {
	return fmt.Sprint(path)
}

// doc is what the proto says about the element at path, its leading comment and then
// its trailing one, with the space protobuf puts after each "//" taken off.
func (c comments) doc(path []int32) string {
	location := c[pathKey(path)]
	if location == nil {
		return ""
	}
	var parts []string
	for _, comment := range []string{location.GetLeadingComments(), location.GetTrailingComments()} {
		if text := commentText(comment); text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, "\n\n")
}

func commentText(comment string) string {
	lines := strings.Split(comment, "\n")
	for i, line := range lines {
		lines[i] = strings.TrimPrefix(strings.TrimRight(line, " \t\r"), " ")
	}
	return strings.Trim(strings.Join(lines, "\n"), "\n")
}

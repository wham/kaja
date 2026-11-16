package kaja

import (
	"encoding/binary"
	"strings"

	"google.golang.org/protobuf/types/descriptorpb"
)

// comments are a file's comments by the path of what they are attached to.
type comments map[string]*descriptorpb.SourceCodeInfo_Location

func fileComments(file *descriptorpb.FileDescriptorProto) comments {
	c := comments{}
	for _, location := range file.GetSourceCodeInfo().GetLocation() {
		// Most locations are positions with nothing said at them.
		if location.LeadingComments == nil && location.TrailingComments == nil {
			continue
		}
		c[string(pathKey(nil, location.Path))] = location
	}
	return c
}

// pathKey appends a path's numbers to key as varints, which is a key no two paths
// share and one a lookup can build without allocating.
func pathKey(key []byte, path []int32) []byte {
	for _, number := range path {
		key = binary.AppendVarint(key, int64(number))
	}
	return key
}

// doc is what the proto says about the element at path, its leading comment and then
// its trailing one, with the space protobuf puts after each "//" taken off.
func (c comments) doc(path []int32) string {
	var key [32]byte
	location := c[string(pathKey(key[:0], path))]
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

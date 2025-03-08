// Code generated by protoc-gen-go. DO NOT EDIT.
// versions:
// 	protoc-gen-go v1.36.5
// 	protoc        v5.29.3
// source: proto/lib/enum.proto

package demo_app

import (
	protoreflect "google.golang.org/protobuf/reflect/protoreflect"
	protoimpl "google.golang.org/protobuf/runtime/protoimpl"
	reflect "reflect"
	sync "sync"
	unsafe "unsafe"
)

const (
	// Verify that this generated code is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(20 - protoimpl.MinVersion)
	// Verify that runtime/protoimpl is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(protoimpl.MaxVersion - 20)
)

type Position int32

const (
	Position_TOP    Position = 0
	Position_BOTTOM Position = 1
)

// Enum value maps for Position.
var (
	Position_name = map[int32]string{
		0: "TOP",
		1: "BOTTOM",
	}
	Position_value = map[string]int32{
		"TOP":    0,
		"BOTTOM": 1,
	}
)

func (x Position) Enum() *Position {
	p := new(Position)
	*p = x
	return p
}

func (x Position) String() string {
	return protoimpl.X.EnumStringOf(x.Descriptor(), protoreflect.EnumNumber(x))
}

func (Position) Descriptor() protoreflect.EnumDescriptor {
	return file_proto_lib_enum_proto_enumTypes[0].Descriptor()
}

func (Position) Type() protoreflect.EnumType {
	return &file_proto_lib_enum_proto_enumTypes[0]
}

func (x Position) Number() protoreflect.EnumNumber {
	return protoreflect.EnumNumber(x)
}

// Deprecated: Use Position.Descriptor instead.
func (Position) EnumDescriptor() ([]byte, []int) {
	return file_proto_lib_enum_proto_rawDescGZIP(), []int{0}
}

var File_proto_lib_enum_proto protoreflect.FileDescriptor

var file_proto_lib_enum_proto_rawDesc = string([]byte{
	0x0a, 0x14, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x2f, 0x6c, 0x69, 0x62, 0x2f, 0x65, 0x6e, 0x75, 0x6d,
	0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x12, 0x03, 0x6c, 0x69, 0x62, 0x2a, 0x1f, 0x0a, 0x08, 0x50,
	0x6f, 0x73, 0x69, 0x74, 0x69, 0x6f, 0x6e, 0x12, 0x07, 0x0a, 0x03, 0x54, 0x4f, 0x50, 0x10, 0x00,
	0x12, 0x0a, 0x0a, 0x06, 0x42, 0x4f, 0x54, 0x54, 0x4f, 0x4d, 0x10, 0x01, 0x42, 0x13, 0x5a, 0x11,
	0x69, 0x6e, 0x74, 0x65, 0x72, 0x6e, 0x61, 0x6c, 0x2f, 0x64, 0x65, 0x6d, 0x6f, 0x2d, 0x61, 0x70,
	0x70, 0x62, 0x06, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x33,
})

var (
	file_proto_lib_enum_proto_rawDescOnce sync.Once
	file_proto_lib_enum_proto_rawDescData []byte
)

func file_proto_lib_enum_proto_rawDescGZIP() []byte {
	file_proto_lib_enum_proto_rawDescOnce.Do(func() {
		file_proto_lib_enum_proto_rawDescData = protoimpl.X.CompressGZIP(unsafe.Slice(unsafe.StringData(file_proto_lib_enum_proto_rawDesc), len(file_proto_lib_enum_proto_rawDesc)))
	})
	return file_proto_lib_enum_proto_rawDescData
}

var file_proto_lib_enum_proto_enumTypes = make([]protoimpl.EnumInfo, 1)
var file_proto_lib_enum_proto_goTypes = []any{
	(Position)(0), // 0: lib.Position
}
var file_proto_lib_enum_proto_depIdxs = []int32{
	0, // [0:0] is the sub-list for method output_type
	0, // [0:0] is the sub-list for method input_type
	0, // [0:0] is the sub-list for extension type_name
	0, // [0:0] is the sub-list for extension extendee
	0, // [0:0] is the sub-list for field type_name
}

func init() { file_proto_lib_enum_proto_init() }
func file_proto_lib_enum_proto_init() {
	if File_proto_lib_enum_proto != nil {
		return
	}
	type x struct{}
	out := protoimpl.TypeBuilder{
		File: protoimpl.DescBuilder{
			GoPackagePath: reflect.TypeOf(x{}).PkgPath(),
			RawDescriptor: unsafe.Slice(unsafe.StringData(file_proto_lib_enum_proto_rawDesc), len(file_proto_lib_enum_proto_rawDesc)),
			NumEnums:      1,
			NumMessages:   0,
			NumExtensions: 0,
			NumServices:   0,
		},
		GoTypes:           file_proto_lib_enum_proto_goTypes,
		DependencyIndexes: file_proto_lib_enum_proto_depIdxs,
		EnumInfos:         file_proto_lib_enum_proto_enumTypes,
	}.Build()
	File_proto_lib_enum_proto = out.File
	file_proto_lib_enum_proto_goTypes = nil
	file_proto_lib_enum_proto_depIdxs = nil
}

// Code generated by protoc-gen-go. DO NOT EDIT.
// versions:
// 	protoc-gen-go v1.36.6
// 	protoc        v5.29.3
// source: proto/quirks.proto

package demo_app

import (
	protoreflect "google.golang.org/protobuf/reflect/protoreflect"
	protoimpl "google.golang.org/protobuf/runtime/protoimpl"
	reflect "reflect"
	unsafe "unsafe"
)

const (
	// Verify that this generated code is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(20 - protoimpl.MinVersion)
	// Verify that runtime/protoimpl is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(protoimpl.MaxVersion - 20)
)

var File_proto_quirks_proto protoreflect.FileDescriptor

const file_proto_quirks_proto_rawDesc = "" +
	"\n" +
	"\x12proto/quirks.proto\x12\tquirks.v1\x1a\x17proto/lib/message.proto2R\n" +
	"\x06Quirks\x12H\n" +
	"-MethodWithAReallyLongNameGmthggupcbmnphflnnvu\x12\t.lib.Void\x1a\f.lib.MessageB\x13Z\x11internal/demo-appb\x06proto3"

var file_proto_quirks_proto_goTypes = []any{
	(*Void)(nil),    // 0: lib.Void
	(*Message)(nil), // 1: lib.Message
}
var file_proto_quirks_proto_depIdxs = []int32{
	0, // 0: quirks.v1.Quirks.MethodWithAReallyLongNameGmthggupcbmnphflnnvu:input_type -> lib.Void
	1, // 1: quirks.v1.Quirks.MethodWithAReallyLongNameGmthggupcbmnphflnnvu:output_type -> lib.Message
	1, // [1:2] is the sub-list for method output_type
	0, // [0:1] is the sub-list for method input_type
	0, // [0:0] is the sub-list for extension type_name
	0, // [0:0] is the sub-list for extension extendee
	0, // [0:0] is the sub-list for field type_name
}

func init() { file_proto_quirks_proto_init() }
func file_proto_quirks_proto_init() {
	if File_proto_quirks_proto != nil {
		return
	}
	file_proto_lib_message_proto_init()
	type x struct{}
	out := protoimpl.TypeBuilder{
		File: protoimpl.DescBuilder{
			GoPackagePath: reflect.TypeOf(x{}).PkgPath(),
			RawDescriptor: unsafe.Slice(unsafe.StringData(file_proto_quirks_proto_rawDesc), len(file_proto_quirks_proto_rawDesc)),
			NumEnums:      0,
			NumMessages:   0,
			NumExtensions: 0,
			NumServices:   1,
		},
		GoTypes:           file_proto_quirks_proto_goTypes,
		DependencyIndexes: file_proto_quirks_proto_depIdxs,
	}.Build()
	File_proto_quirks_proto = out.File
	file_proto_quirks_proto_goTypes = nil
	file_proto_quirks_proto_depIdxs = nil
}

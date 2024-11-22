// Code generated by protoc-gen-go. DO NOT EDIT.
// versions:
// 	protoc-gen-go v1.35.2
// 	protoc        v5.28.2
// source: proto/api.proto

package api

import (
	protoreflect "google.golang.org/protobuf/reflect/protoreflect"
	protoimpl "google.golang.org/protobuf/runtime/protoimpl"
	reflect "reflect"
	sync "sync"
)

const (
	// Verify that this generated code is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(20 - protoimpl.MinVersion)
	// Verify that runtime/protoimpl is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(protoimpl.MaxVersion - 20)
)

type CompileStatus int32

const (
	CompileStatus_STATUS_UNKNOWN CompileStatus = 0
	CompileStatus_STATUS_READY   CompileStatus = 1
	CompileStatus_STATUS_ERROR   CompileStatus = 2
	CompileStatus_STATUS_RUNNING CompileStatus = 3
)

// Enum value maps for CompileStatus.
var (
	CompileStatus_name = map[int32]string{
		0: "STATUS_UNKNOWN",
		1: "STATUS_READY",
		2: "STATUS_ERROR",
		3: "STATUS_RUNNING",
	}
	CompileStatus_value = map[string]int32{
		"STATUS_UNKNOWN": 0,
		"STATUS_READY":   1,
		"STATUS_ERROR":   2,
		"STATUS_RUNNING": 3,
	}
)

func (x CompileStatus) Enum() *CompileStatus {
	p := new(CompileStatus)
	*p = x
	return p
}

func (x CompileStatus) String() string {
	return protoimpl.X.EnumStringOf(x.Descriptor(), protoreflect.EnumNumber(x))
}

func (CompileStatus) Descriptor() protoreflect.EnumDescriptor {
	return file_proto_api_proto_enumTypes[0].Descriptor()
}

func (CompileStatus) Type() protoreflect.EnumType {
	return &file_proto_api_proto_enumTypes[0]
}

func (x CompileStatus) Number() protoreflect.EnumNumber {
	return protoreflect.EnumNumber(x)
}

// Deprecated: Use CompileStatus.Descriptor instead.
func (CompileStatus) EnumDescriptor() ([]byte, []int) {
	return file_proto_api_proto_rawDescGZIP(), []int{0}
}

type LogLevel int32

const (
	LogLevel_LEVEL_DEBUG LogLevel = 0
	LogLevel_LEVEL_INFO  LogLevel = 1
	LogLevel_LEVEL_WARN  LogLevel = 2
	LogLevel_LEVEL_ERROR LogLevel = 3
)

// Enum value maps for LogLevel.
var (
	LogLevel_name = map[int32]string{
		0: "LEVEL_DEBUG",
		1: "LEVEL_INFO",
		2: "LEVEL_WARN",
		3: "LEVEL_ERROR",
	}
	LogLevel_value = map[string]int32{
		"LEVEL_DEBUG": 0,
		"LEVEL_INFO":  1,
		"LEVEL_WARN":  2,
		"LEVEL_ERROR": 3,
	}
)

func (x LogLevel) Enum() *LogLevel {
	p := new(LogLevel)
	*p = x
	return p
}

func (x LogLevel) String() string {
	return protoimpl.X.EnumStringOf(x.Descriptor(), protoreflect.EnumNumber(x))
}

func (LogLevel) Descriptor() protoreflect.EnumDescriptor {
	return file_proto_api_proto_enumTypes[1].Descriptor()
}

func (LogLevel) Type() protoreflect.EnumType {
	return &file_proto_api_proto_enumTypes[1]
}

func (x LogLevel) Number() protoreflect.EnumNumber {
	return protoreflect.EnumNumber(x)
}

// Deprecated: Use LogLevel.Descriptor instead.
func (LogLevel) EnumDescriptor() ([]byte, []int) {
	return file_proto_api_proto_rawDescGZIP(), []int{1}
}

type CompileRequest struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	LogOffset int32 `protobuf:"varint,1,opt,name=log_offset,json=logOffset,proto3" json:"log_offset,omitempty"`
	Force     bool  `protobuf:"varint,2,opt,name=force,proto3" json:"force,omitempty"`
}

func (x *CompileRequest) Reset() {
	*x = CompileRequest{}
	mi := &file_proto_api_proto_msgTypes[0]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *CompileRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*CompileRequest) ProtoMessage() {}

func (x *CompileRequest) ProtoReflect() protoreflect.Message {
	mi := &file_proto_api_proto_msgTypes[0]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use CompileRequest.ProtoReflect.Descriptor instead.
func (*CompileRequest) Descriptor() ([]byte, []int) {
	return file_proto_api_proto_rawDescGZIP(), []int{0}
}

func (x *CompileRequest) GetLogOffset() int32 {
	if x != nil {
		return x.LogOffset
	}
	return 0
}

func (x *CompileRequest) GetForce() bool {
	if x != nil {
		return x.Force
	}
	return false
}

type CompileResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Status  CompileStatus `protobuf:"varint,1,opt,name=status,proto3,enum=CompileStatus" json:"status,omitempty"`
	Logs    []*Log        `protobuf:"bytes,2,rep,name=logs,proto3" json:"logs,omitempty"`
	Sources []string      `protobuf:"bytes,3,rep,name=sources,proto3" json:"sources,omitempty"`
}

func (x *CompileResponse) Reset() {
	*x = CompileResponse{}
	mi := &file_proto_api_proto_msgTypes[1]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *CompileResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*CompileResponse) ProtoMessage() {}

func (x *CompileResponse) ProtoReflect() protoreflect.Message {
	mi := &file_proto_api_proto_msgTypes[1]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use CompileResponse.ProtoReflect.Descriptor instead.
func (*CompileResponse) Descriptor() ([]byte, []int) {
	return file_proto_api_proto_rawDescGZIP(), []int{1}
}

func (x *CompileResponse) GetStatus() CompileStatus {
	if x != nil {
		return x.Status
	}
	return CompileStatus_STATUS_UNKNOWN
}

func (x *CompileResponse) GetLogs() []*Log {
	if x != nil {
		return x.Logs
	}
	return nil
}

func (x *CompileResponse) GetSources() []string {
	if x != nil {
		return x.Sources
	}
	return nil
}

type Log struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Message string   `protobuf:"bytes,1,opt,name=message,proto3" json:"message,omitempty"`
	Index   int32    `protobuf:"varint,2,opt,name=index,proto3" json:"index,omitempty"`
	Level   LogLevel `protobuf:"varint,3,opt,name=level,proto3,enum=LogLevel" json:"level,omitempty"`
}

func (x *Log) Reset() {
	*x = Log{}
	mi := &file_proto_api_proto_msgTypes[2]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *Log) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*Log) ProtoMessage() {}

func (x *Log) ProtoReflect() protoreflect.Message {
	mi := &file_proto_api_proto_msgTypes[2]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use Log.ProtoReflect.Descriptor instead.
func (*Log) Descriptor() ([]byte, []int) {
	return file_proto_api_proto_rawDescGZIP(), []int{2}
}

func (x *Log) GetMessage() string {
	if x != nil {
		return x.Message
	}
	return ""
}

func (x *Log) GetIndex() int32 {
	if x != nil {
		return x.Index
	}
	return 0
}

func (x *Log) GetLevel() LogLevel {
	if x != nil {
		return x.Level
	}
	return LogLevel_LEVEL_DEBUG
}

var File_proto_api_proto protoreflect.FileDescriptor

var file_proto_api_proto_rawDesc = []byte{
	0x0a, 0x0f, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x2f, 0x61, 0x70, 0x69, 0x2e, 0x70, 0x72, 0x6f, 0x74,
	0x6f, 0x22, 0x45, 0x0a, 0x0e, 0x43, 0x6f, 0x6d, 0x70, 0x69, 0x6c, 0x65, 0x52, 0x65, 0x71, 0x75,
	0x65, 0x73, 0x74, 0x12, 0x1d, 0x0a, 0x0a, 0x6c, 0x6f, 0x67, 0x5f, 0x6f, 0x66, 0x66, 0x73, 0x65,
	0x74, 0x18, 0x01, 0x20, 0x01, 0x28, 0x05, 0x52, 0x09, 0x6c, 0x6f, 0x67, 0x4f, 0x66, 0x66, 0x73,
	0x65, 0x74, 0x12, 0x14, 0x0a, 0x05, 0x66, 0x6f, 0x72, 0x63, 0x65, 0x18, 0x02, 0x20, 0x01, 0x28,
	0x08, 0x52, 0x05, 0x66, 0x6f, 0x72, 0x63, 0x65, 0x22, 0x6d, 0x0a, 0x0f, 0x43, 0x6f, 0x6d, 0x70,
	0x69, 0x6c, 0x65, 0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65, 0x12, 0x26, 0x0a, 0x06, 0x73,
	0x74, 0x61, 0x74, 0x75, 0x73, 0x18, 0x01, 0x20, 0x01, 0x28, 0x0e, 0x32, 0x0e, 0x2e, 0x43, 0x6f,
	0x6d, 0x70, 0x69, 0x6c, 0x65, 0x53, 0x74, 0x61, 0x74, 0x75, 0x73, 0x52, 0x06, 0x73, 0x74, 0x61,
	0x74, 0x75, 0x73, 0x12, 0x18, 0x0a, 0x04, 0x6c, 0x6f, 0x67, 0x73, 0x18, 0x02, 0x20, 0x03, 0x28,
	0x0b, 0x32, 0x04, 0x2e, 0x4c, 0x6f, 0x67, 0x52, 0x04, 0x6c, 0x6f, 0x67, 0x73, 0x12, 0x18, 0x0a,
	0x07, 0x73, 0x6f, 0x75, 0x72, 0x63, 0x65, 0x73, 0x18, 0x03, 0x20, 0x03, 0x28, 0x09, 0x52, 0x07,
	0x73, 0x6f, 0x75, 0x72, 0x63, 0x65, 0x73, 0x22, 0x56, 0x0a, 0x03, 0x4c, 0x6f, 0x67, 0x12, 0x18,
	0x0a, 0x07, 0x6d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x18, 0x01, 0x20, 0x01, 0x28, 0x09, 0x52,
	0x07, 0x6d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x12, 0x14, 0x0a, 0x05, 0x69, 0x6e, 0x64, 0x65,
	0x78, 0x18, 0x02, 0x20, 0x01, 0x28, 0x05, 0x52, 0x05, 0x69, 0x6e, 0x64, 0x65, 0x78, 0x12, 0x1f,
	0x0a, 0x05, 0x6c, 0x65, 0x76, 0x65, 0x6c, 0x18, 0x03, 0x20, 0x01, 0x28, 0x0e, 0x32, 0x09, 0x2e,
	0x4c, 0x6f, 0x67, 0x4c, 0x65, 0x76, 0x65, 0x6c, 0x52, 0x05, 0x6c, 0x65, 0x76, 0x65, 0x6c, 0x2a,
	0x5b, 0x0a, 0x0d, 0x43, 0x6f, 0x6d, 0x70, 0x69, 0x6c, 0x65, 0x53, 0x74, 0x61, 0x74, 0x75, 0x73,
	0x12, 0x12, 0x0a, 0x0e, 0x53, 0x54, 0x41, 0x54, 0x55, 0x53, 0x5f, 0x55, 0x4e, 0x4b, 0x4e, 0x4f,
	0x57, 0x4e, 0x10, 0x00, 0x12, 0x10, 0x0a, 0x0c, 0x53, 0x54, 0x41, 0x54, 0x55, 0x53, 0x5f, 0x52,
	0x45, 0x41, 0x44, 0x59, 0x10, 0x01, 0x12, 0x10, 0x0a, 0x0c, 0x53, 0x54, 0x41, 0x54, 0x55, 0x53,
	0x5f, 0x45, 0x52, 0x52, 0x4f, 0x52, 0x10, 0x02, 0x12, 0x12, 0x0a, 0x0e, 0x53, 0x54, 0x41, 0x54,
	0x55, 0x53, 0x5f, 0x52, 0x55, 0x4e, 0x4e, 0x49, 0x4e, 0x47, 0x10, 0x03, 0x2a, 0x4c, 0x0a, 0x08,
	0x4c, 0x6f, 0x67, 0x4c, 0x65, 0x76, 0x65, 0x6c, 0x12, 0x0f, 0x0a, 0x0b, 0x4c, 0x45, 0x56, 0x45,
	0x4c, 0x5f, 0x44, 0x45, 0x42, 0x55, 0x47, 0x10, 0x00, 0x12, 0x0e, 0x0a, 0x0a, 0x4c, 0x45, 0x56,
	0x45, 0x4c, 0x5f, 0x49, 0x4e, 0x46, 0x4f, 0x10, 0x01, 0x12, 0x0e, 0x0a, 0x0a, 0x4c, 0x45, 0x56,
	0x45, 0x4c, 0x5f, 0x57, 0x41, 0x52, 0x4e, 0x10, 0x02, 0x12, 0x0f, 0x0a, 0x0b, 0x4c, 0x45, 0x56,
	0x45, 0x4c, 0x5f, 0x45, 0x52, 0x52, 0x4f, 0x52, 0x10, 0x03, 0x32, 0x33, 0x0a, 0x03, 0x41, 0x70,
	0x69, 0x12, 0x2c, 0x0a, 0x07, 0x43, 0x6f, 0x6d, 0x70, 0x69, 0x6c, 0x65, 0x12, 0x0f, 0x2e, 0x43,
	0x6f, 0x6d, 0x70, 0x69, 0x6c, 0x65, 0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x1a, 0x10, 0x2e,
	0x43, 0x6f, 0x6d, 0x70, 0x69, 0x6c, 0x65, 0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65, 0x42,
	0x0e, 0x5a, 0x0c, 0x69, 0x6e, 0x74, 0x65, 0x72, 0x6e, 0x61, 0x6c, 0x2f, 0x61, 0x70, 0x69, 0x62,
	0x06, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x33,
}

var (
	file_proto_api_proto_rawDescOnce sync.Once
	file_proto_api_proto_rawDescData = file_proto_api_proto_rawDesc
)

func file_proto_api_proto_rawDescGZIP() []byte {
	file_proto_api_proto_rawDescOnce.Do(func() {
		file_proto_api_proto_rawDescData = protoimpl.X.CompressGZIP(file_proto_api_proto_rawDescData)
	})
	return file_proto_api_proto_rawDescData
}

var file_proto_api_proto_enumTypes = make([]protoimpl.EnumInfo, 2)
var file_proto_api_proto_msgTypes = make([]protoimpl.MessageInfo, 3)
var file_proto_api_proto_goTypes = []any{
	(CompileStatus)(0),      // 0: CompileStatus
	(LogLevel)(0),           // 1: LogLevel
	(*CompileRequest)(nil),  // 2: CompileRequest
	(*CompileResponse)(nil), // 3: CompileResponse
	(*Log)(nil),             // 4: Log
}
var file_proto_api_proto_depIdxs = []int32{
	0, // 0: CompileResponse.status:type_name -> CompileStatus
	4, // 1: CompileResponse.logs:type_name -> Log
	1, // 2: Log.level:type_name -> LogLevel
	2, // 3: Api.Compile:input_type -> CompileRequest
	3, // 4: Api.Compile:output_type -> CompileResponse
	4, // [4:5] is the sub-list for method output_type
	3, // [3:4] is the sub-list for method input_type
	3, // [3:3] is the sub-list for extension type_name
	3, // [3:3] is the sub-list for extension extendee
	0, // [0:3] is the sub-list for field type_name
}

func init() { file_proto_api_proto_init() }
func file_proto_api_proto_init() {
	if File_proto_api_proto != nil {
		return
	}
	type x struct{}
	out := protoimpl.TypeBuilder{
		File: protoimpl.DescBuilder{
			GoPackagePath: reflect.TypeOf(x{}).PkgPath(),
			RawDescriptor: file_proto_api_proto_rawDesc,
			NumEnums:      2,
			NumMessages:   3,
			NumExtensions: 0,
			NumServices:   1,
		},
		GoTypes:           file_proto_api_proto_goTypes,
		DependencyIndexes: file_proto_api_proto_depIdxs,
		EnumInfos:         file_proto_api_proto_enumTypes,
		MessageInfos:      file_proto_api_proto_msgTypes,
	}.Build()
	File_proto_api_proto = out.File
	file_proto_api_proto_rawDesc = nil
	file_proto_api_proto_goTypes = nil
	file_proto_api_proto_depIdxs = nil
}

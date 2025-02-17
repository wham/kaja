// Code generated by protoc-gen-go. DO NOT EDIT.
// versions:
// 	protoc-gen-go v1.36.5
// 	protoc        v5.28.2
// source: proto/api.proto

package api

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

type RpcProtocol int32

const (
	RpcProtocol_RPC_PROTOCOL_TWIRP RpcProtocol = 0
	RpcProtocol_RPC_PROTOCOL_GRPC  RpcProtocol = 1
)

// Enum value maps for RpcProtocol.
var (
	RpcProtocol_name = map[int32]string{
		0: "RPC_PROTOCOL_TWIRP",
		1: "RPC_PROTOCOL_GRPC",
	}
	RpcProtocol_value = map[string]int32{
		"RPC_PROTOCOL_TWIRP": 0,
		"RPC_PROTOCOL_GRPC":  1,
	}
)

func (x RpcProtocol) Enum() *RpcProtocol {
	p := new(RpcProtocol)
	*p = x
	return p
}

func (x RpcProtocol) String() string {
	return protoimpl.X.EnumStringOf(x.Descriptor(), protoreflect.EnumNumber(x))
}

func (RpcProtocol) Descriptor() protoreflect.EnumDescriptor {
	return file_proto_api_proto_enumTypes[2].Descriptor()
}

func (RpcProtocol) Type() protoreflect.EnumType {
	return &file_proto_api_proto_enumTypes[2]
}

func (x RpcProtocol) Number() protoreflect.EnumNumber {
	return protoreflect.EnumNumber(x)
}

// Deprecated: Use RpcProtocol.Descriptor instead.
func (RpcProtocol) EnumDescriptor() ([]byte, []int) {
	return file_proto_api_proto_rawDescGZIP(), []int{2}
}

type CompileRequest struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	LogOffset     int32                  `protobuf:"varint,1,opt,name=log_offset,json=logOffset,proto3" json:"log_offset,omitempty"`
	Force         bool                   `protobuf:"varint,2,opt,name=force,proto3" json:"force,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
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
	state         protoimpl.MessageState `protogen:"open.v1"`
	Status        CompileStatus          `protobuf:"varint,1,opt,name=status,proto3,enum=CompileStatus" json:"status,omitempty"`
	Logs          []*Log                 `protobuf:"bytes,2,rep,name=logs,proto3" json:"logs,omitempty"`
	Sources       []string               `protobuf:"bytes,3,rep,name=sources,proto3" json:"sources,omitempty"`
	RpcProtocol   RpcProtocol            `protobuf:"varint,4,opt,name=rpc_protocol,json=rpcProtocol,proto3,enum=RpcProtocol" json:"rpc_protocol,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
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

func (x *CompileResponse) GetRpcProtocol() RpcProtocol {
	if x != nil {
		return x.RpcProtocol
	}
	return RpcProtocol_RPC_PROTOCOL_TWIRP
}

type Log struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	Message       string                 `protobuf:"bytes,1,opt,name=message,proto3" json:"message,omitempty"`
	Index         int32                  `protobuf:"varint,2,opt,name=index,proto3" json:"index,omitempty"`
	Level         LogLevel               `protobuf:"varint,3,opt,name=level,proto3,enum=LogLevel" json:"level,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
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

type GetConfigurationRequest struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *GetConfigurationRequest) Reset() {
	*x = GetConfigurationRequest{}
	mi := &file_proto_api_proto_msgTypes[3]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *GetConfigurationRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*GetConfigurationRequest) ProtoMessage() {}

func (x *GetConfigurationRequest) ProtoReflect() protoreflect.Message {
	mi := &file_proto_api_proto_msgTypes[3]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use GetConfigurationRequest.ProtoReflect.Descriptor instead.
func (*GetConfigurationRequest) Descriptor() ([]byte, []int) {
	return file_proto_api_proto_rawDescGZIP(), []int{3}
}

type GetConfigurationResponse struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	Configuration *Configuration         `protobuf:"bytes,1,opt,name=configuration,proto3" json:"configuration,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *GetConfigurationResponse) Reset() {
	*x = GetConfigurationResponse{}
	mi := &file_proto_api_proto_msgTypes[4]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *GetConfigurationResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*GetConfigurationResponse) ProtoMessage() {}

func (x *GetConfigurationResponse) ProtoReflect() protoreflect.Message {
	mi := &file_proto_api_proto_msgTypes[4]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use GetConfigurationResponse.ProtoReflect.Descriptor instead.
func (*GetConfigurationResponse) Descriptor() ([]byte, []int) {
	return file_proto_api_proto_rawDescGZIP(), []int{4}
}

func (x *GetConfigurationResponse) GetConfiguration() *Configuration {
	if x != nil {
		return x.Configuration
	}
	return nil
}

type Configuration struct {
	state         protoimpl.MessageState  `protogen:"open.v1"`
	Projects      []*ConfigurationProject `protobuf:"bytes,1,rep,name=projects,proto3" json:"projects,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *Configuration) Reset() {
	*x = Configuration{}
	mi := &file_proto_api_proto_msgTypes[5]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *Configuration) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*Configuration) ProtoMessage() {}

func (x *Configuration) ProtoReflect() protoreflect.Message {
	mi := &file_proto_api_proto_msgTypes[5]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use Configuration.ProtoReflect.Descriptor instead.
func (*Configuration) Descriptor() ([]byte, []int) {
	return file_proto_api_proto_rawDescGZIP(), []int{5}
}

func (x *Configuration) GetProjects() []*ConfigurationProject {
	if x != nil {
		return x.Projects
	}
	return nil
}

type ConfigurationProject struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	Name          string                 `protobuf:"bytes,1,opt,name=name,proto3" json:"name,omitempty"`
	Protocol      RpcProtocol            `protobuf:"varint,2,opt,name=protocol,proto3,enum=RpcProtocol" json:"protocol,omitempty"`
	Url           string                 `protobuf:"bytes,3,opt,name=url,proto3" json:"url,omitempty"`
	Workspace     string                 `protobuf:"bytes,4,opt,name=workspace,proto3" json:"workspace,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *ConfigurationProject) Reset() {
	*x = ConfigurationProject{}
	mi := &file_proto_api_proto_msgTypes[6]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *ConfigurationProject) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*ConfigurationProject) ProtoMessage() {}

func (x *ConfigurationProject) ProtoReflect() protoreflect.Message {
	mi := &file_proto_api_proto_msgTypes[6]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use ConfigurationProject.ProtoReflect.Descriptor instead.
func (*ConfigurationProject) Descriptor() ([]byte, []int) {
	return file_proto_api_proto_rawDescGZIP(), []int{6}
}

func (x *ConfigurationProject) GetName() string {
	if x != nil {
		return x.Name
	}
	return ""
}

func (x *ConfigurationProject) GetProtocol() RpcProtocol {
	if x != nil {
		return x.Protocol
	}
	return RpcProtocol_RPC_PROTOCOL_TWIRP
}

func (x *ConfigurationProject) GetUrl() string {
	if x != nil {
		return x.Url
	}
	return ""
}

func (x *ConfigurationProject) GetWorkspace() string {
	if x != nil {
		return x.Workspace
	}
	return ""
}

var File_proto_api_proto protoreflect.FileDescriptor

var file_proto_api_proto_rawDesc = string([]byte{
	0x0a, 0x0f, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x2f, 0x61, 0x70, 0x69, 0x2e, 0x70, 0x72, 0x6f, 0x74,
	0x6f, 0x22, 0x45, 0x0a, 0x0e, 0x43, 0x6f, 0x6d, 0x70, 0x69, 0x6c, 0x65, 0x52, 0x65, 0x71, 0x75,
	0x65, 0x73, 0x74, 0x12, 0x1d, 0x0a, 0x0a, 0x6c, 0x6f, 0x67, 0x5f, 0x6f, 0x66, 0x66, 0x73, 0x65,
	0x74, 0x18, 0x01, 0x20, 0x01, 0x28, 0x05, 0x52, 0x09, 0x6c, 0x6f, 0x67, 0x4f, 0x66, 0x66, 0x73,
	0x65, 0x74, 0x12, 0x14, 0x0a, 0x05, 0x66, 0x6f, 0x72, 0x63, 0x65, 0x18, 0x02, 0x20, 0x01, 0x28,
	0x08, 0x52, 0x05, 0x66, 0x6f, 0x72, 0x63, 0x65, 0x22, 0x9e, 0x01, 0x0a, 0x0f, 0x43, 0x6f, 0x6d,
	0x70, 0x69, 0x6c, 0x65, 0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65, 0x12, 0x26, 0x0a, 0x06,
	0x73, 0x74, 0x61, 0x74, 0x75, 0x73, 0x18, 0x01, 0x20, 0x01, 0x28, 0x0e, 0x32, 0x0e, 0x2e, 0x43,
	0x6f, 0x6d, 0x70, 0x69, 0x6c, 0x65, 0x53, 0x74, 0x61, 0x74, 0x75, 0x73, 0x52, 0x06, 0x73, 0x74,
	0x61, 0x74, 0x75, 0x73, 0x12, 0x18, 0x0a, 0x04, 0x6c, 0x6f, 0x67, 0x73, 0x18, 0x02, 0x20, 0x03,
	0x28, 0x0b, 0x32, 0x04, 0x2e, 0x4c, 0x6f, 0x67, 0x52, 0x04, 0x6c, 0x6f, 0x67, 0x73, 0x12, 0x18,
	0x0a, 0x07, 0x73, 0x6f, 0x75, 0x72, 0x63, 0x65, 0x73, 0x18, 0x03, 0x20, 0x03, 0x28, 0x09, 0x52,
	0x07, 0x73, 0x6f, 0x75, 0x72, 0x63, 0x65, 0x73, 0x12, 0x2f, 0x0a, 0x0c, 0x72, 0x70, 0x63, 0x5f,
	0x70, 0x72, 0x6f, 0x74, 0x6f, 0x63, 0x6f, 0x6c, 0x18, 0x04, 0x20, 0x01, 0x28, 0x0e, 0x32, 0x0c,
	0x2e, 0x52, 0x70, 0x63, 0x50, 0x72, 0x6f, 0x74, 0x6f, 0x63, 0x6f, 0x6c, 0x52, 0x0b, 0x72, 0x70,
	0x63, 0x50, 0x72, 0x6f, 0x74, 0x6f, 0x63, 0x6f, 0x6c, 0x22, 0x56, 0x0a, 0x03, 0x4c, 0x6f, 0x67,
	0x12, 0x18, 0x0a, 0x07, 0x6d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x18, 0x01, 0x20, 0x01, 0x28,
	0x09, 0x52, 0x07, 0x6d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x12, 0x14, 0x0a, 0x05, 0x69, 0x6e,
	0x64, 0x65, 0x78, 0x18, 0x02, 0x20, 0x01, 0x28, 0x05, 0x52, 0x05, 0x69, 0x6e, 0x64, 0x65, 0x78,
	0x12, 0x1f, 0x0a, 0x05, 0x6c, 0x65, 0x76, 0x65, 0x6c, 0x18, 0x03, 0x20, 0x01, 0x28, 0x0e, 0x32,
	0x09, 0x2e, 0x4c, 0x6f, 0x67, 0x4c, 0x65, 0x76, 0x65, 0x6c, 0x52, 0x05, 0x6c, 0x65, 0x76, 0x65,
	0x6c, 0x22, 0x19, 0x0a, 0x17, 0x47, 0x65, 0x74, 0x43, 0x6f, 0x6e, 0x66, 0x69, 0x67, 0x75, 0x72,
	0x61, 0x74, 0x69, 0x6f, 0x6e, 0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x22, 0x50, 0x0a, 0x18,
	0x47, 0x65, 0x74, 0x43, 0x6f, 0x6e, 0x66, 0x69, 0x67, 0x75, 0x72, 0x61, 0x74, 0x69, 0x6f, 0x6e,
	0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65, 0x12, 0x34, 0x0a, 0x0d, 0x63, 0x6f, 0x6e, 0x66,
	0x69, 0x67, 0x75, 0x72, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x18, 0x01, 0x20, 0x01, 0x28, 0x0b, 0x32,
	0x0e, 0x2e, 0x43, 0x6f, 0x6e, 0x66, 0x69, 0x67, 0x75, 0x72, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x52,
	0x0d, 0x63, 0x6f, 0x6e, 0x66, 0x69, 0x67, 0x75, 0x72, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x22, 0x42,
	0x0a, 0x0d, 0x43, 0x6f, 0x6e, 0x66, 0x69, 0x67, 0x75, 0x72, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x12,
	0x31, 0x0a, 0x08, 0x70, 0x72, 0x6f, 0x6a, 0x65, 0x63, 0x74, 0x73, 0x18, 0x01, 0x20, 0x03, 0x28,
	0x0b, 0x32, 0x15, 0x2e, 0x43, 0x6f, 0x6e, 0x66, 0x69, 0x67, 0x75, 0x72, 0x61, 0x74, 0x69, 0x6f,
	0x6e, 0x50, 0x72, 0x6f, 0x6a, 0x65, 0x63, 0x74, 0x52, 0x08, 0x70, 0x72, 0x6f, 0x6a, 0x65, 0x63,
	0x74, 0x73, 0x22, 0x84, 0x01, 0x0a, 0x14, 0x43, 0x6f, 0x6e, 0x66, 0x69, 0x67, 0x75, 0x72, 0x61,
	0x74, 0x69, 0x6f, 0x6e, 0x50, 0x72, 0x6f, 0x6a, 0x65, 0x63, 0x74, 0x12, 0x12, 0x0a, 0x04, 0x6e,
	0x61, 0x6d, 0x65, 0x18, 0x01, 0x20, 0x01, 0x28, 0x09, 0x52, 0x04, 0x6e, 0x61, 0x6d, 0x65, 0x12,
	0x28, 0x0a, 0x08, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x63, 0x6f, 0x6c, 0x18, 0x02, 0x20, 0x01, 0x28,
	0x0e, 0x32, 0x0c, 0x2e, 0x52, 0x70, 0x63, 0x50, 0x72, 0x6f, 0x74, 0x6f, 0x63, 0x6f, 0x6c, 0x52,
	0x08, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x63, 0x6f, 0x6c, 0x12, 0x10, 0x0a, 0x03, 0x75, 0x72, 0x6c,
	0x18, 0x03, 0x20, 0x01, 0x28, 0x09, 0x52, 0x03, 0x75, 0x72, 0x6c, 0x12, 0x1c, 0x0a, 0x09, 0x77,
	0x6f, 0x72, 0x6b, 0x73, 0x70, 0x61, 0x63, 0x65, 0x18, 0x04, 0x20, 0x01, 0x28, 0x09, 0x52, 0x09,
	0x77, 0x6f, 0x72, 0x6b, 0x73, 0x70, 0x61, 0x63, 0x65, 0x2a, 0x5b, 0x0a, 0x0d, 0x43, 0x6f, 0x6d,
	0x70, 0x69, 0x6c, 0x65, 0x53, 0x74, 0x61, 0x74, 0x75, 0x73, 0x12, 0x12, 0x0a, 0x0e, 0x53, 0x54,
	0x41, 0x54, 0x55, 0x53, 0x5f, 0x55, 0x4e, 0x4b, 0x4e, 0x4f, 0x57, 0x4e, 0x10, 0x00, 0x12, 0x10,
	0x0a, 0x0c, 0x53, 0x54, 0x41, 0x54, 0x55, 0x53, 0x5f, 0x52, 0x45, 0x41, 0x44, 0x59, 0x10, 0x01,
	0x12, 0x10, 0x0a, 0x0c, 0x53, 0x54, 0x41, 0x54, 0x55, 0x53, 0x5f, 0x45, 0x52, 0x52, 0x4f, 0x52,
	0x10, 0x02, 0x12, 0x12, 0x0a, 0x0e, 0x53, 0x54, 0x41, 0x54, 0x55, 0x53, 0x5f, 0x52, 0x55, 0x4e,
	0x4e, 0x49, 0x4e, 0x47, 0x10, 0x03, 0x2a, 0x4c, 0x0a, 0x08, 0x4c, 0x6f, 0x67, 0x4c, 0x65, 0x76,
	0x65, 0x6c, 0x12, 0x0f, 0x0a, 0x0b, 0x4c, 0x45, 0x56, 0x45, 0x4c, 0x5f, 0x44, 0x45, 0x42, 0x55,
	0x47, 0x10, 0x00, 0x12, 0x0e, 0x0a, 0x0a, 0x4c, 0x45, 0x56, 0x45, 0x4c, 0x5f, 0x49, 0x4e, 0x46,
	0x4f, 0x10, 0x01, 0x12, 0x0e, 0x0a, 0x0a, 0x4c, 0x45, 0x56, 0x45, 0x4c, 0x5f, 0x57, 0x41, 0x52,
	0x4e, 0x10, 0x02, 0x12, 0x0f, 0x0a, 0x0b, 0x4c, 0x45, 0x56, 0x45, 0x4c, 0x5f, 0x45, 0x52, 0x52,
	0x4f, 0x52, 0x10, 0x03, 0x2a, 0x3c, 0x0a, 0x0b, 0x52, 0x70, 0x63, 0x50, 0x72, 0x6f, 0x74, 0x6f,
	0x63, 0x6f, 0x6c, 0x12, 0x16, 0x0a, 0x12, 0x52, 0x50, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x54, 0x4f,
	0x43, 0x4f, 0x4c, 0x5f, 0x54, 0x57, 0x49, 0x52, 0x50, 0x10, 0x00, 0x12, 0x15, 0x0a, 0x11, 0x52,
	0x50, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x54, 0x4f, 0x43, 0x4f, 0x4c, 0x5f, 0x47, 0x52, 0x50, 0x43,
	0x10, 0x01, 0x32, 0x7c, 0x0a, 0x03, 0x41, 0x70, 0x69, 0x12, 0x2c, 0x0a, 0x07, 0x43, 0x6f, 0x6d,
	0x70, 0x69, 0x6c, 0x65, 0x12, 0x0f, 0x2e, 0x43, 0x6f, 0x6d, 0x70, 0x69, 0x6c, 0x65, 0x52, 0x65,
	0x71, 0x75, 0x65, 0x73, 0x74, 0x1a, 0x10, 0x2e, 0x43, 0x6f, 0x6d, 0x70, 0x69, 0x6c, 0x65, 0x52,
	0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65, 0x12, 0x47, 0x0a, 0x10, 0x47, 0x65, 0x74, 0x43, 0x6f,
	0x6e, 0x66, 0x69, 0x67, 0x75, 0x72, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x12, 0x18, 0x2e, 0x47, 0x65,
	0x74, 0x43, 0x6f, 0x6e, 0x66, 0x69, 0x67, 0x75, 0x72, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x52, 0x65,
	0x71, 0x75, 0x65, 0x73, 0x74, 0x1a, 0x19, 0x2e, 0x47, 0x65, 0x74, 0x43, 0x6f, 0x6e, 0x66, 0x69,
	0x67, 0x75, 0x72, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65,
	0x42, 0x0e, 0x5a, 0x0c, 0x69, 0x6e, 0x74, 0x65, 0x72, 0x6e, 0x61, 0x6c, 0x2f, 0x61, 0x70, 0x69,
	0x62, 0x06, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x33,
})

var (
	file_proto_api_proto_rawDescOnce sync.Once
	file_proto_api_proto_rawDescData []byte
)

func file_proto_api_proto_rawDescGZIP() []byte {
	file_proto_api_proto_rawDescOnce.Do(func() {
		file_proto_api_proto_rawDescData = protoimpl.X.CompressGZIP(unsafe.Slice(unsafe.StringData(file_proto_api_proto_rawDesc), len(file_proto_api_proto_rawDesc)))
	})
	return file_proto_api_proto_rawDescData
}

var file_proto_api_proto_enumTypes = make([]protoimpl.EnumInfo, 3)
var file_proto_api_proto_msgTypes = make([]protoimpl.MessageInfo, 7)
var file_proto_api_proto_goTypes = []any{
	(CompileStatus)(0),               // 0: CompileStatus
	(LogLevel)(0),                    // 1: LogLevel
	(RpcProtocol)(0),                 // 2: RpcProtocol
	(*CompileRequest)(nil),           // 3: CompileRequest
	(*CompileResponse)(nil),          // 4: CompileResponse
	(*Log)(nil),                      // 5: Log
	(*GetConfigurationRequest)(nil),  // 6: GetConfigurationRequest
	(*GetConfigurationResponse)(nil), // 7: GetConfigurationResponse
	(*Configuration)(nil),            // 8: Configuration
	(*ConfigurationProject)(nil),     // 9: ConfigurationProject
}
var file_proto_api_proto_depIdxs = []int32{
	0, // 0: CompileResponse.status:type_name -> CompileStatus
	5, // 1: CompileResponse.logs:type_name -> Log
	2, // 2: CompileResponse.rpc_protocol:type_name -> RpcProtocol
	1, // 3: Log.level:type_name -> LogLevel
	8, // 4: GetConfigurationResponse.configuration:type_name -> Configuration
	9, // 5: Configuration.projects:type_name -> ConfigurationProject
	2, // 6: ConfigurationProject.protocol:type_name -> RpcProtocol
	3, // 7: Api.Compile:input_type -> CompileRequest
	6, // 8: Api.GetConfiguration:input_type -> GetConfigurationRequest
	4, // 9: Api.Compile:output_type -> CompileResponse
	7, // 10: Api.GetConfiguration:output_type -> GetConfigurationResponse
	9, // [9:11] is the sub-list for method output_type
	7, // [7:9] is the sub-list for method input_type
	7, // [7:7] is the sub-list for extension type_name
	7, // [7:7] is the sub-list for extension extendee
	0, // [0:7] is the sub-list for field type_name
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
			RawDescriptor: unsafe.Slice(unsafe.StringData(file_proto_api_proto_rawDesc), len(file_proto_api_proto_rawDesc)),
			NumEnums:      3,
			NumMessages:   7,
			NumExtensions: 0,
			NumServices:   1,
		},
		GoTypes:           file_proto_api_proto_goTypes,
		DependencyIndexes: file_proto_api_proto_depIdxs,
		EnumInfos:         file_proto_api_proto_enumTypes,
		MessageInfos:      file_proto_api_proto_msgTypes,
	}.Build()
	File_proto_api_proto = out.File
	file_proto_api_proto_goTypes = nil
	file_proto_api_proto_depIdxs = nil
}

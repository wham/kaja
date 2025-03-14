// Code generated by protoc-gen-go. DO NOT EDIT.
// versions:
// 	protoc-gen-go v1.36.5
// 	protoc        v5.29.3
// source: proto/quirks.proto

package demo_app

import (
	protoreflect "google.golang.org/protobuf/reflect/protoreflect"
	protoimpl "google.golang.org/protobuf/runtime/protoimpl"
	timestamppb "google.golang.org/protobuf/types/known/timestamppb"
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

type Enum int32

const (
	Enum_KEY_0 Enum = 0
	Enum_KEY_1 Enum = 1
)

// Enum value maps for Enum.
var (
	Enum_name = map[int32]string{
		0: "KEY_0",
		1: "KEY_1",
	}
	Enum_value = map[string]int32{
		"KEY_0": 0,
		"KEY_1": 1,
	}
)

func (x Enum) Enum() *Enum {
	p := new(Enum)
	*p = x
	return p
}

func (x Enum) String() string {
	return protoimpl.X.EnumStringOf(x.Descriptor(), protoreflect.EnumNumber(x))
}

func (Enum) Descriptor() protoreflect.EnumDescriptor {
	return file_proto_quirks_proto_enumTypes[0].Descriptor()
}

func (Enum) Type() protoreflect.EnumType {
	return &file_proto_quirks_proto_enumTypes[0]
}

func (x Enum) Number() protoreflect.EnumNumber {
	return protoreflect.EnumNumber(x)
}

// Deprecated: Use Enum.Descriptor instead.
func (Enum) EnumDescriptor() ([]byte, []int) {
	return file_proto_quirks_proto_rawDescGZIP(), []int{0}
}

type TypesRequest_NestedEnum int32

const (
	TypesRequest_KEY_0 TypesRequest_NestedEnum = 0
	TypesRequest_KEY_1 TypesRequest_NestedEnum = 1
)

// Enum value maps for TypesRequest_NestedEnum.
var (
	TypesRequest_NestedEnum_name = map[int32]string{
		0: "KEY_0",
		1: "KEY_1",
	}
	TypesRequest_NestedEnum_value = map[string]int32{
		"KEY_0": 0,
		"KEY_1": 1,
	}
)

func (x TypesRequest_NestedEnum) Enum() *TypesRequest_NestedEnum {
	p := new(TypesRequest_NestedEnum)
	*p = x
	return p
}

func (x TypesRequest_NestedEnum) String() string {
	return protoimpl.X.EnumStringOf(x.Descriptor(), protoreflect.EnumNumber(x))
}

func (TypesRequest_NestedEnum) Descriptor() protoreflect.EnumDescriptor {
	return file_proto_quirks_proto_enumTypes[1].Descriptor()
}

func (TypesRequest_NestedEnum) Type() protoreflect.EnumType {
	return &file_proto_quirks_proto_enumTypes[1]
}

func (x TypesRequest_NestedEnum) Number() protoreflect.EnumNumber {
	return protoreflect.EnumNumber(x)
}

// Deprecated: Use TypesRequest_NestedEnum.Descriptor instead.
func (TypesRequest_NestedEnum) EnumDescriptor() ([]byte, []int) {
	return file_proto_quirks_proto_rawDescGZIP(), []int{2, 0}
}

type MapRequest struct {
	state                protoimpl.MessageState                `protogen:"open.v1"`
	StringString         map[string]string                     `protobuf:"bytes,1,rep,name=string_string,json=stringString,proto3" json:"string_string,omitempty" protobuf_key:"bytes,1,opt,name=key" protobuf_val:"bytes,2,opt,name=value"`
	StringInt32          map[string]int32                      `protobuf:"bytes,2,rep,name=string_int32,json=stringInt32,proto3" json:"string_int32,omitempty" protobuf_key:"bytes,1,opt,name=key" protobuf_val:"varint,2,opt,name=value"`
	Sint64String         map[int64]string                      `protobuf:"bytes,3,rep,name=sint64_string,json=sint64String,proto3" json:"sint64_string,omitempty" protobuf_key:"zigzag64,1,opt,name=key" protobuf_val:"bytes,2,opt,name=value"`
	StringRepeatedString map[string]*MapRequest_RepeatedString `protobuf:"bytes,4,rep,name=string_repeated_string,json=stringRepeatedString,proto3" json:"string_repeated_string,omitempty" protobuf_key:"bytes,1,opt,name=key" protobuf_val:"bytes,2,opt,name=value"`
	unknownFields        protoimpl.UnknownFields
	sizeCache            protoimpl.SizeCache
}

func (x *MapRequest) Reset() {
	*x = MapRequest{}
	mi := &file_proto_quirks_proto_msgTypes[0]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *MapRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*MapRequest) ProtoMessage() {}

func (x *MapRequest) ProtoReflect() protoreflect.Message {
	mi := &file_proto_quirks_proto_msgTypes[0]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use MapRequest.ProtoReflect.Descriptor instead.
func (*MapRequest) Descriptor() ([]byte, []int) {
	return file_proto_quirks_proto_rawDescGZIP(), []int{0}
}

func (x *MapRequest) GetStringString() map[string]string {
	if x != nil {
		return x.StringString
	}
	return nil
}

func (x *MapRequest) GetStringInt32() map[string]int32 {
	if x != nil {
		return x.StringInt32
	}
	return nil
}

func (x *MapRequest) GetSint64String() map[int64]string {
	if x != nil {
		return x.Sint64String
	}
	return nil
}

func (x *MapRequest) GetStringRepeatedString() map[string]*MapRequest_RepeatedString {
	if x != nil {
		return x.StringRepeatedString
	}
	return nil
}

type RepeatedRequest struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	String_       []string               `protobuf:"bytes,1,rep,name=string,proto3" json:"string,omitempty"`
	Int32         []int32                `protobuf:"varint,2,rep,packed,name=int32,proto3" json:"int32,omitempty"`
	Enum          []Enum                 `protobuf:"varint,3,rep,packed,name=enum,proto3,enum=quirks.v1.Enum" json:"enum,omitempty"`
	Message       []*Message             `protobuf:"bytes,4,rep,name=message,proto3" json:"message,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *RepeatedRequest) Reset() {
	*x = RepeatedRequest{}
	mi := &file_proto_quirks_proto_msgTypes[1]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *RepeatedRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*RepeatedRequest) ProtoMessage() {}

func (x *RepeatedRequest) ProtoReflect() protoreflect.Message {
	mi := &file_proto_quirks_proto_msgTypes[1]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use RepeatedRequest.ProtoReflect.Descriptor instead.
func (*RepeatedRequest) Descriptor() ([]byte, []int) {
	return file_proto_quirks_proto_rawDescGZIP(), []int{1}
}

func (x *RepeatedRequest) GetString_() []string {
	if x != nil {
		return x.String_
	}
	return nil
}

func (x *RepeatedRequest) GetInt32() []int32 {
	if x != nil {
		return x.Int32
	}
	return nil
}

func (x *RepeatedRequest) GetEnum() []Enum {
	if x != nil {
		return x.Enum
	}
	return nil
}

func (x *RepeatedRequest) GetMessage() []*Message {
	if x != nil {
		return x.Message
	}
	return nil
}

type TypesRequest struct {
	state         protoimpl.MessageState  `protogen:"open.v1"`
	Timestamp     *timestamppb.Timestamp  `protobuf:"bytes,1,opt,name=timestamp,proto3" json:"timestamp,omitempty"`
	Bool          bool                    `protobuf:"varint,2,opt,name=bool,proto3" json:"bool,omitempty"`
	Enum          Enum                    `protobuf:"varint,3,opt,name=enum,proto3,enum=quirks.v1.Enum" json:"enum,omitempty"`
	NestedEnum    TypesRequest_NestedEnum `protobuf:"varint,4,opt,name=nested_enum,json=nestedEnum,proto3,enum=quirks.v1.TypesRequest_NestedEnum" json:"nested_enum,omitempty"`
	Position      Position                `protobuf:"varint,5,opt,name=position,proto3,enum=lib.Position" json:"position,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *TypesRequest) Reset() {
	*x = TypesRequest{}
	mi := &file_proto_quirks_proto_msgTypes[2]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *TypesRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*TypesRequest) ProtoMessage() {}

func (x *TypesRequest) ProtoReflect() protoreflect.Message {
	mi := &file_proto_quirks_proto_msgTypes[2]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use TypesRequest.ProtoReflect.Descriptor instead.
func (*TypesRequest) Descriptor() ([]byte, []int) {
	return file_proto_quirks_proto_rawDescGZIP(), []int{2}
}

func (x *TypesRequest) GetTimestamp() *timestamppb.Timestamp {
	if x != nil {
		return x.Timestamp
	}
	return nil
}

func (x *TypesRequest) GetBool() bool {
	if x != nil {
		return x.Bool
	}
	return false
}

func (x *TypesRequest) GetEnum() Enum {
	if x != nil {
		return x.Enum
	}
	return Enum_KEY_0
}

func (x *TypesRequest) GetNestedEnum() TypesRequest_NestedEnum {
	if x != nil {
		return x.NestedEnum
	}
	return TypesRequest_KEY_0
}

func (x *TypesRequest) GetPosition() Position {
	if x != nil {
		return x.Position
	}
	return Position_TOP
}

type Void struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *Void) Reset() {
	*x = Void{}
	mi := &file_proto_quirks_proto_msgTypes[3]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *Void) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*Void) ProtoMessage() {}

func (x *Void) ProtoReflect() protoreflect.Message {
	mi := &file_proto_quirks_proto_msgTypes[3]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use Void.ProtoReflect.Descriptor instead.
func (*Void) Descriptor() ([]byte, []int) {
	return file_proto_quirks_proto_rawDescGZIP(), []int{3}
}

type MapRequest_RepeatedString struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	Value         []string               `protobuf:"bytes,1,rep,name=value,proto3" json:"value,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *MapRequest_RepeatedString) Reset() {
	*x = MapRequest_RepeatedString{}
	mi := &file_proto_quirks_proto_msgTypes[4]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *MapRequest_RepeatedString) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*MapRequest_RepeatedString) ProtoMessage() {}

func (x *MapRequest_RepeatedString) ProtoReflect() protoreflect.Message {
	mi := &file_proto_quirks_proto_msgTypes[4]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use MapRequest_RepeatedString.ProtoReflect.Descriptor instead.
func (*MapRequest_RepeatedString) Descriptor() ([]byte, []int) {
	return file_proto_quirks_proto_rawDescGZIP(), []int{0, 0}
}

func (x *MapRequest_RepeatedString) GetValue() []string {
	if x != nil {
		return x.Value
	}
	return nil
}

var File_proto_quirks_proto protoreflect.FileDescriptor

var file_proto_quirks_proto_rawDesc = string([]byte{
	0x0a, 0x12, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x2f, 0x71, 0x75, 0x69, 0x72, 0x6b, 0x73, 0x2e, 0x70,
	0x72, 0x6f, 0x74, 0x6f, 0x12, 0x09, 0x71, 0x75, 0x69, 0x72, 0x6b, 0x73, 0x2e, 0x76, 0x31, 0x1a,
	0x1f, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x2f, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x62, 0x75, 0x66,
	0x2f, 0x74, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f,
	0x1a, 0x14, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x2f, 0x6c, 0x69, 0x62, 0x2f, 0x65, 0x6e, 0x75, 0x6d,
	0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x1a, 0x17, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x2f, 0x6c, 0x69,
	0x62, 0x2f, 0x6d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x22,
	0xb3, 0x05, 0x0a, 0x0a, 0x4d, 0x61, 0x70, 0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x12, 0x4c,
	0x0a, 0x0d, 0x73, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x5f, 0x73, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x18,
	0x01, 0x20, 0x03, 0x28, 0x0b, 0x32, 0x27, 0x2e, 0x71, 0x75, 0x69, 0x72, 0x6b, 0x73, 0x2e, 0x76,
	0x31, 0x2e, 0x4d, 0x61, 0x70, 0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x2e, 0x53, 0x74, 0x72,
	0x69, 0x6e, 0x67, 0x53, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x45, 0x6e, 0x74, 0x72, 0x79, 0x52, 0x0c,
	0x73, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x53, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x12, 0x49, 0x0a, 0x0c,
	0x73, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x5f, 0x69, 0x6e, 0x74, 0x33, 0x32, 0x18, 0x02, 0x20, 0x03,
	0x28, 0x0b, 0x32, 0x26, 0x2e, 0x71, 0x75, 0x69, 0x72, 0x6b, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x4d,
	0x61, 0x70, 0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x2e, 0x53, 0x74, 0x72, 0x69, 0x6e, 0x67,
	0x49, 0x6e, 0x74, 0x33, 0x32, 0x45, 0x6e, 0x74, 0x72, 0x79, 0x52, 0x0b, 0x73, 0x74, 0x72, 0x69,
	0x6e, 0x67, 0x49, 0x6e, 0x74, 0x33, 0x32, 0x12, 0x4c, 0x0a, 0x0d, 0x73, 0x69, 0x6e, 0x74, 0x36,
	0x34, 0x5f, 0x73, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x18, 0x03, 0x20, 0x03, 0x28, 0x0b, 0x32, 0x27,
	0x2e, 0x71, 0x75, 0x69, 0x72, 0x6b, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x4d, 0x61, 0x70, 0x52, 0x65,
	0x71, 0x75, 0x65, 0x73, 0x74, 0x2e, 0x53, 0x69, 0x6e, 0x74, 0x36, 0x34, 0x53, 0x74, 0x72, 0x69,
	0x6e, 0x67, 0x45, 0x6e, 0x74, 0x72, 0x79, 0x52, 0x0c, 0x73, 0x69, 0x6e, 0x74, 0x36, 0x34, 0x53,
	0x74, 0x72, 0x69, 0x6e, 0x67, 0x12, 0x65, 0x0a, 0x16, 0x73, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x5f,
	0x72, 0x65, 0x70, 0x65, 0x61, 0x74, 0x65, 0x64, 0x5f, 0x73, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x18,
	0x04, 0x20, 0x03, 0x28, 0x0b, 0x32, 0x2f, 0x2e, 0x71, 0x75, 0x69, 0x72, 0x6b, 0x73, 0x2e, 0x76,
	0x31, 0x2e, 0x4d, 0x61, 0x70, 0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x2e, 0x53, 0x74, 0x72,
	0x69, 0x6e, 0x67, 0x52, 0x65, 0x70, 0x65, 0x61, 0x74, 0x65, 0x64, 0x53, 0x74, 0x72, 0x69, 0x6e,
	0x67, 0x45, 0x6e, 0x74, 0x72, 0x79, 0x52, 0x14, 0x73, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x52, 0x65,
	0x70, 0x65, 0x61, 0x74, 0x65, 0x64, 0x53, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x1a, 0x26, 0x0a, 0x0e,
	0x52, 0x65, 0x70, 0x65, 0x61, 0x74, 0x65, 0x64, 0x53, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x12, 0x14,
	0x0a, 0x05, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x18, 0x01, 0x20, 0x03, 0x28, 0x09, 0x52, 0x05, 0x76,
	0x61, 0x6c, 0x75, 0x65, 0x1a, 0x3f, 0x0a, 0x11, 0x53, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x53, 0x74,
	0x72, 0x69, 0x6e, 0x67, 0x45, 0x6e, 0x74, 0x72, 0x79, 0x12, 0x10, 0x0a, 0x03, 0x6b, 0x65, 0x79,
	0x18, 0x01, 0x20, 0x01, 0x28, 0x09, 0x52, 0x03, 0x6b, 0x65, 0x79, 0x12, 0x14, 0x0a, 0x05, 0x76,
	0x61, 0x6c, 0x75, 0x65, 0x18, 0x02, 0x20, 0x01, 0x28, 0x09, 0x52, 0x05, 0x76, 0x61, 0x6c, 0x75,
	0x65, 0x3a, 0x02, 0x38, 0x01, 0x1a, 0x3e, 0x0a, 0x10, 0x53, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x49,
	0x6e, 0x74, 0x33, 0x32, 0x45, 0x6e, 0x74, 0x72, 0x79, 0x12, 0x10, 0x0a, 0x03, 0x6b, 0x65, 0x79,
	0x18, 0x01, 0x20, 0x01, 0x28, 0x09, 0x52, 0x03, 0x6b, 0x65, 0x79, 0x12, 0x14, 0x0a, 0x05, 0x76,
	0x61, 0x6c, 0x75, 0x65, 0x18, 0x02, 0x20, 0x01, 0x28, 0x05, 0x52, 0x05, 0x76, 0x61, 0x6c, 0x75,
	0x65, 0x3a, 0x02, 0x38, 0x01, 0x1a, 0x3f, 0x0a, 0x11, 0x53, 0x69, 0x6e, 0x74, 0x36, 0x34, 0x53,
	0x74, 0x72, 0x69, 0x6e, 0x67, 0x45, 0x6e, 0x74, 0x72, 0x79, 0x12, 0x10, 0x0a, 0x03, 0x6b, 0x65,
	0x79, 0x18, 0x01, 0x20, 0x01, 0x28, 0x12, 0x52, 0x03, 0x6b, 0x65, 0x79, 0x12, 0x14, 0x0a, 0x05,
	0x76, 0x61, 0x6c, 0x75, 0x65, 0x18, 0x02, 0x20, 0x01, 0x28, 0x09, 0x52, 0x05, 0x76, 0x61, 0x6c,
	0x75, 0x65, 0x3a, 0x02, 0x38, 0x01, 0x1a, 0x6d, 0x0a, 0x19, 0x53, 0x74, 0x72, 0x69, 0x6e, 0x67,
	0x52, 0x65, 0x70, 0x65, 0x61, 0x74, 0x65, 0x64, 0x53, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x45, 0x6e,
	0x74, 0x72, 0x79, 0x12, 0x10, 0x0a, 0x03, 0x6b, 0x65, 0x79, 0x18, 0x01, 0x20, 0x01, 0x28, 0x09,
	0x52, 0x03, 0x6b, 0x65, 0x79, 0x12, 0x3a, 0x0a, 0x05, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x18, 0x02,
	0x20, 0x01, 0x28, 0x0b, 0x32, 0x24, 0x2e, 0x71, 0x75, 0x69, 0x72, 0x6b, 0x73, 0x2e, 0x76, 0x31,
	0x2e, 0x4d, 0x61, 0x70, 0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x2e, 0x52, 0x65, 0x70, 0x65,
	0x61, 0x74, 0x65, 0x64, 0x53, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x52, 0x05, 0x76, 0x61, 0x6c, 0x75,
	0x65, 0x3a, 0x02, 0x38, 0x01, 0x22, 0x8c, 0x01, 0x0a, 0x0f, 0x52, 0x65, 0x70, 0x65, 0x61, 0x74,
	0x65, 0x64, 0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x12, 0x16, 0x0a, 0x06, 0x73, 0x74, 0x72,
	0x69, 0x6e, 0x67, 0x18, 0x01, 0x20, 0x03, 0x28, 0x09, 0x52, 0x06, 0x73, 0x74, 0x72, 0x69, 0x6e,
	0x67, 0x12, 0x14, 0x0a, 0x05, 0x69, 0x6e, 0x74, 0x33, 0x32, 0x18, 0x02, 0x20, 0x03, 0x28, 0x05,
	0x52, 0x05, 0x69, 0x6e, 0x74, 0x33, 0x32, 0x12, 0x23, 0x0a, 0x04, 0x65, 0x6e, 0x75, 0x6d, 0x18,
	0x03, 0x20, 0x03, 0x28, 0x0e, 0x32, 0x0f, 0x2e, 0x71, 0x75, 0x69, 0x72, 0x6b, 0x73, 0x2e, 0x76,
	0x31, 0x2e, 0x45, 0x6e, 0x75, 0x6d, 0x52, 0x04, 0x65, 0x6e, 0x75, 0x6d, 0x12, 0x26, 0x0a, 0x07,
	0x6d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x18, 0x04, 0x20, 0x03, 0x28, 0x0b, 0x32, 0x0c, 0x2e,
	0x6c, 0x69, 0x62, 0x2e, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x52, 0x07, 0x6d, 0x65, 0x73,
	0x73, 0x61, 0x67, 0x65, 0x22, 0x95, 0x02, 0x0a, 0x0c, 0x54, 0x79, 0x70, 0x65, 0x73, 0x52, 0x65,
	0x71, 0x75, 0x65, 0x73, 0x74, 0x12, 0x38, 0x0a, 0x09, 0x74, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61,
	0x6d, 0x70, 0x18, 0x01, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x1a, 0x2e, 0x67, 0x6f, 0x6f, 0x67, 0x6c,
	0x65, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x62, 0x75, 0x66, 0x2e, 0x54, 0x69, 0x6d, 0x65, 0x73,
	0x74, 0x61, 0x6d, 0x70, 0x52, 0x09, 0x74, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x12,
	0x12, 0x0a, 0x04, 0x62, 0x6f, 0x6f, 0x6c, 0x18, 0x02, 0x20, 0x01, 0x28, 0x08, 0x52, 0x04, 0x62,
	0x6f, 0x6f, 0x6c, 0x12, 0x23, 0x0a, 0x04, 0x65, 0x6e, 0x75, 0x6d, 0x18, 0x03, 0x20, 0x01, 0x28,
	0x0e, 0x32, 0x0f, 0x2e, 0x71, 0x75, 0x69, 0x72, 0x6b, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x45, 0x6e,
	0x75, 0x6d, 0x52, 0x04, 0x65, 0x6e, 0x75, 0x6d, 0x12, 0x43, 0x0a, 0x0b, 0x6e, 0x65, 0x73, 0x74,
	0x65, 0x64, 0x5f, 0x65, 0x6e, 0x75, 0x6d, 0x18, 0x04, 0x20, 0x01, 0x28, 0x0e, 0x32, 0x22, 0x2e,
	0x71, 0x75, 0x69, 0x72, 0x6b, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x54, 0x79, 0x70, 0x65, 0x73, 0x52,
	0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x2e, 0x4e, 0x65, 0x73, 0x74, 0x65, 0x64, 0x45, 0x6e, 0x75,
	0x6d, 0x52, 0x0a, 0x6e, 0x65, 0x73, 0x74, 0x65, 0x64, 0x45, 0x6e, 0x75, 0x6d, 0x12, 0x29, 0x0a,
	0x08, 0x70, 0x6f, 0x73, 0x69, 0x74, 0x69, 0x6f, 0x6e, 0x18, 0x05, 0x20, 0x01, 0x28, 0x0e, 0x32,
	0x0d, 0x2e, 0x6c, 0x69, 0x62, 0x2e, 0x50, 0x6f, 0x73, 0x69, 0x74, 0x69, 0x6f, 0x6e, 0x52, 0x08,
	0x70, 0x6f, 0x73, 0x69, 0x74, 0x69, 0x6f, 0x6e, 0x22, 0x22, 0x0a, 0x0a, 0x4e, 0x65, 0x73, 0x74,
	0x65, 0x64, 0x45, 0x6e, 0x75, 0x6d, 0x12, 0x09, 0x0a, 0x05, 0x4b, 0x45, 0x59, 0x5f, 0x30, 0x10,
	0x00, 0x12, 0x09, 0x0a, 0x05, 0x4b, 0x45, 0x59, 0x5f, 0x31, 0x10, 0x01, 0x22, 0x06, 0x0a, 0x04,
	0x56, 0x6f, 0x69, 0x64, 0x2a, 0x1c, 0x0a, 0x04, 0x45, 0x6e, 0x75, 0x6d, 0x12, 0x09, 0x0a, 0x05,
	0x4b, 0x45, 0x59, 0x5f, 0x30, 0x10, 0x00, 0x12, 0x09, 0x0a, 0x05, 0x4b, 0x45, 0x59, 0x5f, 0x31,
	0x10, 0x01, 0x32, 0xe8, 0x02, 0x0a, 0x06, 0x51, 0x75, 0x69, 0x72, 0x6b, 0x73, 0x12, 0x32, 0x0a,
	0x11, 0x47, 0x65, 0x74, 0x41, 0x75, 0x74, 0x68, 0x65, 0x6e, 0x74, 0x69, 0x63, 0x61, 0x74, 0x69,
	0x6f, 0x6e, 0x12, 0x0f, 0x2e, 0x71, 0x75, 0x69, 0x72, 0x6b, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x56,
	0x6f, 0x69, 0x64, 0x1a, 0x0c, 0x2e, 0x6c, 0x69, 0x62, 0x2e, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67,
	0x65, 0x12, 0x33, 0x0a, 0x03, 0x4d, 0x61, 0x70, 0x12, 0x15, 0x2e, 0x71, 0x75, 0x69, 0x72, 0x6b,
	0x73, 0x2e, 0x76, 0x31, 0x2e, 0x4d, 0x61, 0x70, 0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x1a,
	0x15, 0x2e, 0x71, 0x75, 0x69, 0x72, 0x6b, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x4d, 0x61, 0x70, 0x52,
	0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x12, 0x4e, 0x0a, 0x2d, 0x4d, 0x65, 0x74, 0x68, 0x6f, 0x64,
	0x57, 0x69, 0x74, 0x68, 0x41, 0x52, 0x65, 0x61, 0x6c, 0x6c, 0x79, 0x4c, 0x6f, 0x6e, 0x67, 0x4e,
	0x61, 0x6d, 0x65, 0x47, 0x6d, 0x74, 0x68, 0x67, 0x67, 0x75, 0x70, 0x63, 0x62, 0x6d, 0x6e, 0x70,
	0x68, 0x66, 0x6c, 0x6e, 0x6e, 0x76, 0x75, 0x12, 0x0f, 0x2e, 0x71, 0x75, 0x69, 0x72, 0x6b, 0x73,
	0x2e, 0x76, 0x31, 0x2e, 0x56, 0x6f, 0x69, 0x64, 0x1a, 0x0c, 0x2e, 0x6c, 0x69, 0x62, 0x2e, 0x4d,
	0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x12, 0x26, 0x0a, 0x05, 0x50, 0x61, 0x6e, 0x69, 0x63, 0x12,
	0x0f, 0x2e, 0x71, 0x75, 0x69, 0x72, 0x6b, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x56, 0x6f, 0x69, 0x64,
	0x1a, 0x0c, 0x2e, 0x6c, 0x69, 0x62, 0x2e, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x12, 0x42,
	0x0a, 0x08, 0x52, 0x65, 0x70, 0x65, 0x61, 0x74, 0x65, 0x64, 0x12, 0x1a, 0x2e, 0x71, 0x75, 0x69,
	0x72, 0x6b, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x52, 0x65, 0x70, 0x65, 0x61, 0x74, 0x65, 0x64, 0x52,
	0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x1a, 0x1a, 0x2e, 0x71, 0x75, 0x69, 0x72, 0x6b, 0x73, 0x2e,
	0x76, 0x31, 0x2e, 0x52, 0x65, 0x70, 0x65, 0x61, 0x74, 0x65, 0x64, 0x52, 0x65, 0x71, 0x75, 0x65,
	0x73, 0x74, 0x12, 0x39, 0x0a, 0x05, 0x54, 0x79, 0x70, 0x65, 0x73, 0x12, 0x17, 0x2e, 0x71, 0x75,
	0x69, 0x72, 0x6b, 0x73, 0x2e, 0x76, 0x31, 0x2e, 0x54, 0x79, 0x70, 0x65, 0x73, 0x52, 0x65, 0x71,
	0x75, 0x65, 0x73, 0x74, 0x1a, 0x17, 0x2e, 0x71, 0x75, 0x69, 0x72, 0x6b, 0x73, 0x2e, 0x76, 0x31,
	0x2e, 0x54, 0x79, 0x70, 0x65, 0x73, 0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x42, 0x13, 0x5a,
	0x11, 0x69, 0x6e, 0x74, 0x65, 0x72, 0x6e, 0x61, 0x6c, 0x2f, 0x64, 0x65, 0x6d, 0x6f, 0x2d, 0x61,
	0x70, 0x70, 0x62, 0x06, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x33,
})

var (
	file_proto_quirks_proto_rawDescOnce sync.Once
	file_proto_quirks_proto_rawDescData []byte
)

func file_proto_quirks_proto_rawDescGZIP() []byte {
	file_proto_quirks_proto_rawDescOnce.Do(func() {
		file_proto_quirks_proto_rawDescData = protoimpl.X.CompressGZIP(unsafe.Slice(unsafe.StringData(file_proto_quirks_proto_rawDesc), len(file_proto_quirks_proto_rawDesc)))
	})
	return file_proto_quirks_proto_rawDescData
}

var file_proto_quirks_proto_enumTypes = make([]protoimpl.EnumInfo, 2)
var file_proto_quirks_proto_msgTypes = make([]protoimpl.MessageInfo, 9)
var file_proto_quirks_proto_goTypes = []any{
	(Enum)(0),                         // 0: quirks.v1.Enum
	(TypesRequest_NestedEnum)(0),      // 1: quirks.v1.TypesRequest.NestedEnum
	(*MapRequest)(nil),                // 2: quirks.v1.MapRequest
	(*RepeatedRequest)(nil),           // 3: quirks.v1.RepeatedRequest
	(*TypesRequest)(nil),              // 4: quirks.v1.TypesRequest
	(*Void)(nil),                      // 5: quirks.v1.Void
	(*MapRequest_RepeatedString)(nil), // 6: quirks.v1.MapRequest.RepeatedString
	nil,                               // 7: quirks.v1.MapRequest.StringStringEntry
	nil,                               // 8: quirks.v1.MapRequest.StringInt32Entry
	nil,                               // 9: quirks.v1.MapRequest.Sint64StringEntry
	nil,                               // 10: quirks.v1.MapRequest.StringRepeatedStringEntry
	(*Message)(nil),                   // 11: lib.Message
	(*timestamppb.Timestamp)(nil),     // 12: google.protobuf.Timestamp
	(Position)(0),                     // 13: lib.Position
}
var file_proto_quirks_proto_depIdxs = []int32{
	7,  // 0: quirks.v1.MapRequest.string_string:type_name -> quirks.v1.MapRequest.StringStringEntry
	8,  // 1: quirks.v1.MapRequest.string_int32:type_name -> quirks.v1.MapRequest.StringInt32Entry
	9,  // 2: quirks.v1.MapRequest.sint64_string:type_name -> quirks.v1.MapRequest.Sint64StringEntry
	10, // 3: quirks.v1.MapRequest.string_repeated_string:type_name -> quirks.v1.MapRequest.StringRepeatedStringEntry
	0,  // 4: quirks.v1.RepeatedRequest.enum:type_name -> quirks.v1.Enum
	11, // 5: quirks.v1.RepeatedRequest.message:type_name -> lib.Message
	12, // 6: quirks.v1.TypesRequest.timestamp:type_name -> google.protobuf.Timestamp
	0,  // 7: quirks.v1.TypesRequest.enum:type_name -> quirks.v1.Enum
	1,  // 8: quirks.v1.TypesRequest.nested_enum:type_name -> quirks.v1.TypesRequest.NestedEnum
	13, // 9: quirks.v1.TypesRequest.position:type_name -> lib.Position
	6,  // 10: quirks.v1.MapRequest.StringRepeatedStringEntry.value:type_name -> quirks.v1.MapRequest.RepeatedString
	5,  // 11: quirks.v1.Quirks.GetAuthentication:input_type -> quirks.v1.Void
	2,  // 12: quirks.v1.Quirks.Map:input_type -> quirks.v1.MapRequest
	5,  // 13: quirks.v1.Quirks.MethodWithAReallyLongNameGmthggupcbmnphflnnvu:input_type -> quirks.v1.Void
	5,  // 14: quirks.v1.Quirks.Panic:input_type -> quirks.v1.Void
	3,  // 15: quirks.v1.Quirks.Repeated:input_type -> quirks.v1.RepeatedRequest
	4,  // 16: quirks.v1.Quirks.Types:input_type -> quirks.v1.TypesRequest
	11, // 17: quirks.v1.Quirks.GetAuthentication:output_type -> lib.Message
	2,  // 18: quirks.v1.Quirks.Map:output_type -> quirks.v1.MapRequest
	11, // 19: quirks.v1.Quirks.MethodWithAReallyLongNameGmthggupcbmnphflnnvu:output_type -> lib.Message
	11, // 20: quirks.v1.Quirks.Panic:output_type -> lib.Message
	3,  // 21: quirks.v1.Quirks.Repeated:output_type -> quirks.v1.RepeatedRequest
	4,  // 22: quirks.v1.Quirks.Types:output_type -> quirks.v1.TypesRequest
	17, // [17:23] is the sub-list for method output_type
	11, // [11:17] is the sub-list for method input_type
	11, // [11:11] is the sub-list for extension type_name
	11, // [11:11] is the sub-list for extension extendee
	0,  // [0:11] is the sub-list for field type_name
}

func init() { file_proto_quirks_proto_init() }
func file_proto_quirks_proto_init() {
	if File_proto_quirks_proto != nil {
		return
	}
	file_proto_lib_enum_proto_init()
	file_proto_lib_message_proto_init()
	type x struct{}
	out := protoimpl.TypeBuilder{
		File: protoimpl.DescBuilder{
			GoPackagePath: reflect.TypeOf(x{}).PkgPath(),
			RawDescriptor: unsafe.Slice(unsafe.StringData(file_proto_quirks_proto_rawDesc), len(file_proto_quirks_proto_rawDesc)),
			NumEnums:      2,
			NumMessages:   9,
			NumExtensions: 0,
			NumServices:   1,
		},
		GoTypes:           file_proto_quirks_proto_goTypes,
		DependencyIndexes: file_proto_quirks_proto_depIdxs,
		EnumInfos:         file_proto_quirks_proto_enumTypes,
		MessageInfos:      file_proto_quirks_proto_msgTypes,
	}.Build()
	File_proto_quirks_proto = out.File
	file_proto_quirks_proto_goTypes = nil
	file_proto_quirks_proto_depIdxs = nil
}

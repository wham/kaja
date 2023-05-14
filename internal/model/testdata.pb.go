// Code generated by protoc-gen-go. DO NOT EDIT.
// versions:
// 	protoc-gen-go v1.30.0
// 	protoc        v3.21.12
// source: internal/model/testdata.proto

package model

import (
	protoreflect "google.golang.org/protobuf/reflect/protoreflect"
	protoimpl "google.golang.org/protobuf/runtime/protoimpl"
	timestamppb "google.golang.org/protobuf/types/known/timestamppb"
	reflect "reflect"
	sync "sync"
)

const (
	// Verify that this generated code is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(20 - protoimpl.MinVersion)
	// Verify that runtime/protoimpl is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(protoimpl.MaxVersion - 20)
)

type TestMessage1_Enum int32

const (
	TestMessage1_KEY_0 TestMessage1_Enum = 0
	TestMessage1_KEY_1 TestMessage1_Enum = 1
)

// Enum value maps for TestMessage1_Enum.
var (
	TestMessage1_Enum_name = map[int32]string{
		0: "KEY_0",
		1: "KEY_1",
	}
	TestMessage1_Enum_value = map[string]int32{
		"KEY_0": 0,
		"KEY_1": 1,
	}
)

func (x TestMessage1_Enum) Enum() *TestMessage1_Enum {
	p := new(TestMessage1_Enum)
	*p = x
	return p
}

func (x TestMessage1_Enum) String() string {
	return protoimpl.X.EnumStringOf(x.Descriptor(), protoreflect.EnumNumber(x))
}

func (TestMessage1_Enum) Descriptor() protoreflect.EnumDescriptor {
	return file_internal_model_testdata_proto_enumTypes[0].Descriptor()
}

func (TestMessage1_Enum) Type() protoreflect.EnumType {
	return &file_internal_model_testdata_proto_enumTypes[0]
}

func (x TestMessage1_Enum) Number() protoreflect.EnumNumber {
	return protoreflect.EnumNumber(x)
}

// Deprecated: Use TestMessage1_Enum.Descriptor instead.
func (TestMessage1_Enum) EnumDescriptor() ([]byte, []int) {
	return file_internal_model_testdata_proto_rawDescGZIP(), []int{0, 0}
}

type TestMessage1 struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	String_         string                       `protobuf:"bytes,1,opt,name=string,proto3" json:"string,omitempty"`
	Int32           int32                        `protobuf:"varint,2,opt,name=int32,proto3" json:"int32,omitempty"`
	Bool            bool                         `protobuf:"varint,3,opt,name=bool,proto3" json:"bool,omitempty"`
	RepeatedString  []string                     `protobuf:"bytes,4,rep,name=repeated_string,json=repeatedString,proto3" json:"repeated_string,omitempty"`
	RepeatedInt32   []int32                      `protobuf:"varint,5,rep,packed,name=repeated_int32,json=repeatedInt32,proto3" json:"repeated_int32,omitempty"`
	RepeatedEnum    []TestMessage1_Enum          `protobuf:"varint,6,rep,packed,name=repeated_enum,json=repeatedEnum,proto3,enum=TestMessage1_Enum" json:"repeated_enum,omitempty"`
	RepeatedMessage []*TestMessage1_Message      `protobuf:"bytes,7,rep,name=repeated_message,json=repeatedMessage,proto3" json:"repeated_message,omitempty"`
	NestedMessage   *TestMessage1_NestedMessage1 `protobuf:"bytes,8,opt,name=nested_message,json=nestedMessage,proto3" json:"nested_message,omitempty"`
	Timestamp       *timestamppb.Timestamp       `protobuf:"bytes,9,opt,name=timestamp,proto3" json:"timestamp,omitempty"`
	MapStringSint64 map[string]int64             `protobuf:"bytes,10,rep,name=map_string_sint64,json=mapStringSint64,proto3" json:"map_string_sint64,omitempty" protobuf_key:"bytes,1,opt,name=key,proto3" protobuf_val:"zigzag64,2,opt,name=value,proto3"`
	Enum            TestMessage1_Enum            `protobuf:"varint,11,opt,name=enum,proto3,enum=TestMessage1_Enum" json:"enum,omitempty"`
}

func (x *TestMessage1) Reset() {
	*x = TestMessage1{}
	if protoimpl.UnsafeEnabled {
		mi := &file_internal_model_testdata_proto_msgTypes[0]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *TestMessage1) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*TestMessage1) ProtoMessage() {}

func (x *TestMessage1) ProtoReflect() protoreflect.Message {
	mi := &file_internal_model_testdata_proto_msgTypes[0]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use TestMessage1.ProtoReflect.Descriptor instead.
func (*TestMessage1) Descriptor() ([]byte, []int) {
	return file_internal_model_testdata_proto_rawDescGZIP(), []int{0}
}

func (x *TestMessage1) GetString_() string {
	if x != nil {
		return x.String_
	}
	return ""
}

func (x *TestMessage1) GetInt32() int32 {
	if x != nil {
		return x.Int32
	}
	return 0
}

func (x *TestMessage1) GetBool() bool {
	if x != nil {
		return x.Bool
	}
	return false
}

func (x *TestMessage1) GetRepeatedString() []string {
	if x != nil {
		return x.RepeatedString
	}
	return nil
}

func (x *TestMessage1) GetRepeatedInt32() []int32 {
	if x != nil {
		return x.RepeatedInt32
	}
	return nil
}

func (x *TestMessage1) GetRepeatedEnum() []TestMessage1_Enum {
	if x != nil {
		return x.RepeatedEnum
	}
	return nil
}

func (x *TestMessage1) GetRepeatedMessage() []*TestMessage1_Message {
	if x != nil {
		return x.RepeatedMessage
	}
	return nil
}

func (x *TestMessage1) GetNestedMessage() *TestMessage1_NestedMessage1 {
	if x != nil {
		return x.NestedMessage
	}
	return nil
}

func (x *TestMessage1) GetTimestamp() *timestamppb.Timestamp {
	if x != nil {
		return x.Timestamp
	}
	return nil
}

func (x *TestMessage1) GetMapStringSint64() map[string]int64 {
	if x != nil {
		return x.MapStringSint64
	}
	return nil
}

func (x *TestMessage1) GetEnum() TestMessage1_Enum {
	if x != nil {
		return x.Enum
	}
	return TestMessage1_KEY_0
}

type TestMessage1_Message struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Name    string `protobuf:"bytes,1,opt,name=name,proto3" json:"name,omitempty"`
	IsValid bool   `protobuf:"varint,2,opt,name=is_valid,json=isValid,proto3" json:"is_valid,omitempty"`
}

func (x *TestMessage1_Message) Reset() {
	*x = TestMessage1_Message{}
	if protoimpl.UnsafeEnabled {
		mi := &file_internal_model_testdata_proto_msgTypes[1]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *TestMessage1_Message) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*TestMessage1_Message) ProtoMessage() {}

func (x *TestMessage1_Message) ProtoReflect() protoreflect.Message {
	mi := &file_internal_model_testdata_proto_msgTypes[1]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use TestMessage1_Message.ProtoReflect.Descriptor instead.
func (*TestMessage1_Message) Descriptor() ([]byte, []int) {
	return file_internal_model_testdata_proto_rawDescGZIP(), []int{0, 0}
}

func (x *TestMessage1_Message) GetName() string {
	if x != nil {
		return x.Name
	}
	return ""
}

func (x *TestMessage1_Message) GetIsValid() bool {
	if x != nil {
		return x.IsValid
	}
	return false
}

type TestMessage1_NestedMessage1 struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Name                 string                       `protobuf:"bytes,1,opt,name=name,proto3" json:"name,omitempty"`
	AnotherNestedMessage *TestMessage1_NestedMessage2 `protobuf:"bytes,2,opt,name=another_nested_message,json=anotherNestedMessage,proto3" json:"another_nested_message,omitempty"`
}

func (x *TestMessage1_NestedMessage1) Reset() {
	*x = TestMessage1_NestedMessage1{}
	if protoimpl.UnsafeEnabled {
		mi := &file_internal_model_testdata_proto_msgTypes[2]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *TestMessage1_NestedMessage1) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*TestMessage1_NestedMessage1) ProtoMessage() {}

func (x *TestMessage1_NestedMessage1) ProtoReflect() protoreflect.Message {
	mi := &file_internal_model_testdata_proto_msgTypes[2]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use TestMessage1_NestedMessage1.ProtoReflect.Descriptor instead.
func (*TestMessage1_NestedMessage1) Descriptor() ([]byte, []int) {
	return file_internal_model_testdata_proto_rawDescGZIP(), []int{0, 1}
}

func (x *TestMessage1_NestedMessage1) GetName() string {
	if x != nil {
		return x.Name
	}
	return ""
}

func (x *TestMessage1_NestedMessage1) GetAnotherNestedMessage() *TestMessage1_NestedMessage2 {
	if x != nil {
		return x.AnotherNestedMessage
	}
	return nil
}

type TestMessage1_NestedMessage2 struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Ids []int32 `protobuf:"zigzag32,1,rep,packed,name=ids,proto3" json:"ids,omitempty"`
}

func (x *TestMessage1_NestedMessage2) Reset() {
	*x = TestMessage1_NestedMessage2{}
	if protoimpl.UnsafeEnabled {
		mi := &file_internal_model_testdata_proto_msgTypes[3]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *TestMessage1_NestedMessage2) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*TestMessage1_NestedMessage2) ProtoMessage() {}

func (x *TestMessage1_NestedMessage2) ProtoReflect() protoreflect.Message {
	mi := &file_internal_model_testdata_proto_msgTypes[3]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use TestMessage1_NestedMessage2.ProtoReflect.Descriptor instead.
func (*TestMessage1_NestedMessage2) Descriptor() ([]byte, []int) {
	return file_internal_model_testdata_proto_rawDescGZIP(), []int{0, 2}
}

func (x *TestMessage1_NestedMessage2) GetIds() []int32 {
	if x != nil {
		return x.Ids
	}
	return nil
}

var File_internal_model_testdata_proto protoreflect.FileDescriptor

var file_internal_model_testdata_proto_rawDesc = []byte{
	0x0a, 0x1d, 0x69, 0x6e, 0x74, 0x65, 0x72, 0x6e, 0x61, 0x6c, 0x2f, 0x6d, 0x6f, 0x64, 0x65, 0x6c,
	0x2f, 0x74, 0x65, 0x73, 0x74, 0x64, 0x61, 0x74, 0x61, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x1a,
	0x1f, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x2f, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x62, 0x75, 0x66,
	0x2f, 0x74, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f,
	0x22, 0xcc, 0x06, 0x0a, 0x0c, 0x54, 0x65, 0x73, 0x74, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65,
	0x31, 0x12, 0x16, 0x0a, 0x06, 0x73, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x18, 0x01, 0x20, 0x01, 0x28,
	0x09, 0x52, 0x06, 0x73, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x12, 0x14, 0x0a, 0x05, 0x69, 0x6e, 0x74,
	0x33, 0x32, 0x18, 0x02, 0x20, 0x01, 0x28, 0x05, 0x52, 0x05, 0x69, 0x6e, 0x74, 0x33, 0x32, 0x12,
	0x12, 0x0a, 0x04, 0x62, 0x6f, 0x6f, 0x6c, 0x18, 0x03, 0x20, 0x01, 0x28, 0x08, 0x52, 0x04, 0x62,
	0x6f, 0x6f, 0x6c, 0x12, 0x27, 0x0a, 0x0f, 0x72, 0x65, 0x70, 0x65, 0x61, 0x74, 0x65, 0x64, 0x5f,
	0x73, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x18, 0x04, 0x20, 0x03, 0x28, 0x09, 0x52, 0x0e, 0x72, 0x65,
	0x70, 0x65, 0x61, 0x74, 0x65, 0x64, 0x53, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x12, 0x25, 0x0a, 0x0e,
	0x72, 0x65, 0x70, 0x65, 0x61, 0x74, 0x65, 0x64, 0x5f, 0x69, 0x6e, 0x74, 0x33, 0x32, 0x18, 0x05,
	0x20, 0x03, 0x28, 0x05, 0x52, 0x0d, 0x72, 0x65, 0x70, 0x65, 0x61, 0x74, 0x65, 0x64, 0x49, 0x6e,
	0x74, 0x33, 0x32, 0x12, 0x37, 0x0a, 0x0d, 0x72, 0x65, 0x70, 0x65, 0x61, 0x74, 0x65, 0x64, 0x5f,
	0x65, 0x6e, 0x75, 0x6d, 0x18, 0x06, 0x20, 0x03, 0x28, 0x0e, 0x32, 0x12, 0x2e, 0x54, 0x65, 0x73,
	0x74, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x31, 0x2e, 0x45, 0x6e, 0x75, 0x6d, 0x52, 0x0c,
	0x72, 0x65, 0x70, 0x65, 0x61, 0x74, 0x65, 0x64, 0x45, 0x6e, 0x75, 0x6d, 0x12, 0x40, 0x0a, 0x10,
	0x72, 0x65, 0x70, 0x65, 0x61, 0x74, 0x65, 0x64, 0x5f, 0x6d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65,
	0x18, 0x07, 0x20, 0x03, 0x28, 0x0b, 0x32, 0x15, 0x2e, 0x54, 0x65, 0x73, 0x74, 0x4d, 0x65, 0x73,
	0x73, 0x61, 0x67, 0x65, 0x31, 0x2e, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x52, 0x0f, 0x72,
	0x65, 0x70, 0x65, 0x61, 0x74, 0x65, 0x64, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x12, 0x43,
	0x0a, 0x0e, 0x6e, 0x65, 0x73, 0x74, 0x65, 0x64, 0x5f, 0x6d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65,
	0x18, 0x08, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x1c, 0x2e, 0x54, 0x65, 0x73, 0x74, 0x4d, 0x65, 0x73,
	0x73, 0x61, 0x67, 0x65, 0x31, 0x2e, 0x4e, 0x65, 0x73, 0x74, 0x65, 0x64, 0x4d, 0x65, 0x73, 0x73,
	0x61, 0x67, 0x65, 0x31, 0x52, 0x0d, 0x6e, 0x65, 0x73, 0x74, 0x65, 0x64, 0x4d, 0x65, 0x73, 0x73,
	0x61, 0x67, 0x65, 0x12, 0x38, 0x0a, 0x09, 0x74, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70,
	0x18, 0x09, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x1a, 0x2e, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x2e,
	0x70, 0x72, 0x6f, 0x74, 0x6f, 0x62, 0x75, 0x66, 0x2e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61,
	0x6d, 0x70, 0x52, 0x09, 0x74, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x12, 0x4e, 0x0a,
	0x11, 0x6d, 0x61, 0x70, 0x5f, 0x73, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x5f, 0x73, 0x69, 0x6e, 0x74,
	0x36, 0x34, 0x18, 0x0a, 0x20, 0x03, 0x28, 0x0b, 0x32, 0x22, 0x2e, 0x54, 0x65, 0x73, 0x74, 0x4d,
	0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x31, 0x2e, 0x4d, 0x61, 0x70, 0x53, 0x74, 0x72, 0x69, 0x6e,
	0x67, 0x53, 0x69, 0x6e, 0x74, 0x36, 0x34, 0x45, 0x6e, 0x74, 0x72, 0x79, 0x52, 0x0f, 0x6d, 0x61,
	0x70, 0x53, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x53, 0x69, 0x6e, 0x74, 0x36, 0x34, 0x12, 0x26, 0x0a,
	0x04, 0x65, 0x6e, 0x75, 0x6d, 0x18, 0x0b, 0x20, 0x01, 0x28, 0x0e, 0x32, 0x12, 0x2e, 0x54, 0x65,
	0x73, 0x74, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x31, 0x2e, 0x45, 0x6e, 0x75, 0x6d, 0x52,
	0x04, 0x65, 0x6e, 0x75, 0x6d, 0x1a, 0x38, 0x0a, 0x07, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65,
	0x12, 0x12, 0x0a, 0x04, 0x6e, 0x61, 0x6d, 0x65, 0x18, 0x01, 0x20, 0x01, 0x28, 0x09, 0x52, 0x04,
	0x6e, 0x61, 0x6d, 0x65, 0x12, 0x19, 0x0a, 0x08, 0x69, 0x73, 0x5f, 0x76, 0x61, 0x6c, 0x69, 0x64,
	0x18, 0x02, 0x20, 0x01, 0x28, 0x08, 0x52, 0x07, 0x69, 0x73, 0x56, 0x61, 0x6c, 0x69, 0x64, 0x1a,
	0x78, 0x0a, 0x0e, 0x4e, 0x65, 0x73, 0x74, 0x65, 0x64, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65,
	0x31, 0x12, 0x12, 0x0a, 0x04, 0x6e, 0x61, 0x6d, 0x65, 0x18, 0x01, 0x20, 0x01, 0x28, 0x09, 0x52,
	0x04, 0x6e, 0x61, 0x6d, 0x65, 0x12, 0x52, 0x0a, 0x16, 0x61, 0x6e, 0x6f, 0x74, 0x68, 0x65, 0x72,
	0x5f, 0x6e, 0x65, 0x73, 0x74, 0x65, 0x64, 0x5f, 0x6d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x18,
	0x02, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x1c, 0x2e, 0x54, 0x65, 0x73, 0x74, 0x4d, 0x65, 0x73, 0x73,
	0x61, 0x67, 0x65, 0x31, 0x2e, 0x4e, 0x65, 0x73, 0x74, 0x65, 0x64, 0x4d, 0x65, 0x73, 0x73, 0x61,
	0x67, 0x65, 0x32, 0x52, 0x14, 0x61, 0x6e, 0x6f, 0x74, 0x68, 0x65, 0x72, 0x4e, 0x65, 0x73, 0x74,
	0x65, 0x64, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x1a, 0x22, 0x0a, 0x0e, 0x4e, 0x65, 0x73,
	0x74, 0x65, 0x64, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x32, 0x12, 0x10, 0x0a, 0x03, 0x69,
	0x64, 0x73, 0x18, 0x01, 0x20, 0x03, 0x28, 0x11, 0x52, 0x03, 0x69, 0x64, 0x73, 0x1a, 0x42, 0x0a,
	0x14, 0x4d, 0x61, 0x70, 0x53, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x53, 0x69, 0x6e, 0x74, 0x36, 0x34,
	0x45, 0x6e, 0x74, 0x72, 0x79, 0x12, 0x10, 0x0a, 0x03, 0x6b, 0x65, 0x79, 0x18, 0x01, 0x20, 0x01,
	0x28, 0x09, 0x52, 0x03, 0x6b, 0x65, 0x79, 0x12, 0x14, 0x0a, 0x05, 0x76, 0x61, 0x6c, 0x75, 0x65,
	0x18, 0x02, 0x20, 0x01, 0x28, 0x12, 0x52, 0x05, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x3a, 0x02, 0x38,
	0x01, 0x22, 0x1c, 0x0a, 0x04, 0x45, 0x6e, 0x75, 0x6d, 0x12, 0x09, 0x0a, 0x05, 0x4b, 0x45, 0x59,
	0x5f, 0x30, 0x10, 0x00, 0x12, 0x09, 0x0a, 0x05, 0x4b, 0x45, 0x59, 0x5f, 0x31, 0x10, 0x01, 0x42,
	0x10, 0x5a, 0x0e, 0x69, 0x6e, 0x74, 0x65, 0x72, 0x6e, 0x61, 0x6c, 0x2f, 0x6d, 0x6f, 0x64, 0x65,
	0x6c, 0x62, 0x06, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x33,
}

var (
	file_internal_model_testdata_proto_rawDescOnce sync.Once
	file_internal_model_testdata_proto_rawDescData = file_internal_model_testdata_proto_rawDesc
)

func file_internal_model_testdata_proto_rawDescGZIP() []byte {
	file_internal_model_testdata_proto_rawDescOnce.Do(func() {
		file_internal_model_testdata_proto_rawDescData = protoimpl.X.CompressGZIP(file_internal_model_testdata_proto_rawDescData)
	})
	return file_internal_model_testdata_proto_rawDescData
}

var file_internal_model_testdata_proto_enumTypes = make([]protoimpl.EnumInfo, 1)
var file_internal_model_testdata_proto_msgTypes = make([]protoimpl.MessageInfo, 5)
var file_internal_model_testdata_proto_goTypes = []interface{}{
	(TestMessage1_Enum)(0),              // 0: TestMessage1.Enum
	(*TestMessage1)(nil),                // 1: TestMessage1
	(*TestMessage1_Message)(nil),        // 2: TestMessage1.Message
	(*TestMessage1_NestedMessage1)(nil), // 3: TestMessage1.NestedMessage1
	(*TestMessage1_NestedMessage2)(nil), // 4: TestMessage1.NestedMessage2
	nil,                                 // 5: TestMessage1.MapStringSint64Entry
	(*timestamppb.Timestamp)(nil),       // 6: google.protobuf.Timestamp
}
var file_internal_model_testdata_proto_depIdxs = []int32{
	0, // 0: TestMessage1.repeated_enum:type_name -> TestMessage1.Enum
	2, // 1: TestMessage1.repeated_message:type_name -> TestMessage1.Message
	3, // 2: TestMessage1.nested_message:type_name -> TestMessage1.NestedMessage1
	6, // 3: TestMessage1.timestamp:type_name -> google.protobuf.Timestamp
	5, // 4: TestMessage1.map_string_sint64:type_name -> TestMessage1.MapStringSint64Entry
	0, // 5: TestMessage1.enum:type_name -> TestMessage1.Enum
	4, // 6: TestMessage1.NestedMessage1.another_nested_message:type_name -> TestMessage1.NestedMessage2
	7, // [7:7] is the sub-list for method output_type
	7, // [7:7] is the sub-list for method input_type
	7, // [7:7] is the sub-list for extension type_name
	7, // [7:7] is the sub-list for extension extendee
	0, // [0:7] is the sub-list for field type_name
}

func init() { file_internal_model_testdata_proto_init() }
func file_internal_model_testdata_proto_init() {
	if File_internal_model_testdata_proto != nil {
		return
	}
	if !protoimpl.UnsafeEnabled {
		file_internal_model_testdata_proto_msgTypes[0].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*TestMessage1); i {
			case 0:
				return &v.state
			case 1:
				return &v.sizeCache
			case 2:
				return &v.unknownFields
			default:
				return nil
			}
		}
		file_internal_model_testdata_proto_msgTypes[1].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*TestMessage1_Message); i {
			case 0:
				return &v.state
			case 1:
				return &v.sizeCache
			case 2:
				return &v.unknownFields
			default:
				return nil
			}
		}
		file_internal_model_testdata_proto_msgTypes[2].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*TestMessage1_NestedMessage1); i {
			case 0:
				return &v.state
			case 1:
				return &v.sizeCache
			case 2:
				return &v.unknownFields
			default:
				return nil
			}
		}
		file_internal_model_testdata_proto_msgTypes[3].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*TestMessage1_NestedMessage2); i {
			case 0:
				return &v.state
			case 1:
				return &v.sizeCache
			case 2:
				return &v.unknownFields
			default:
				return nil
			}
		}
	}
	type x struct{}
	out := protoimpl.TypeBuilder{
		File: protoimpl.DescBuilder{
			GoPackagePath: reflect.TypeOf(x{}).PkgPath(),
			RawDescriptor: file_internal_model_testdata_proto_rawDesc,
			NumEnums:      1,
			NumMessages:   5,
			NumExtensions: 0,
			NumServices:   0,
		},
		GoTypes:           file_internal_model_testdata_proto_goTypes,
		DependencyIndexes: file_internal_model_testdata_proto_depIdxs,
		EnumInfos:         file_internal_model_testdata_proto_enumTypes,
		MessageInfos:      file_internal_model_testdata_proto_msgTypes,
	}.Build()
	File_internal_model_testdata_proto = out.File
	file_internal_model_testdata_proto_rawDesc = nil
	file_internal_model_testdata_proto_goTypes = nil
	file_internal_model_testdata_proto_depIdxs = nil
}

// Code generated by protoc-gen-go. DO NOT EDIT.
// versions:
// 	protoc-gen-go v1.31.0
// 	protoc        v3.21.12
// source: search-service.proto

package demo_app

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

type Position int32

const (
	Position_POSITION_TOP    Position = 0
	Position_POSITION_BOTTOM Position = 1
)

// Enum value maps for Position.
var (
	Position_name = map[int32]string{
		0: "POSITION_TOP",
		1: "POSITION_BOTTOM",
	}
	Position_value = map[string]int32{
		"POSITION_TOP":    0,
		"POSITION_BOTTOM": 1,
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
	return file_search_service_proto_enumTypes[0].Descriptor()
}

func (Position) Type() protoreflect.EnumType {
	return &file_search_service_proto_enumTypes[0]
}

func (x Position) Number() protoreflect.EnumNumber {
	return protoreflect.EnumNumber(x)
}

// Deprecated: Use Position.Descriptor instead.
func (Position) EnumDescriptor() ([]byte, []int) {
	return file_search_service_proto_rawDescGZIP(), []int{0}
}

type SearchRequest struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Query         string `protobuf:"bytes,1,opt,name=query,proto3" json:"query,omitempty"`
	PageNumber    int32  `protobuf:"varint,2,opt,name=page_number,json=pageNumber,proto3" json:"page_number,omitempty"`
	ResultPerPage int32  `protobuf:"varint,3,opt,name=result_per_page,json=resultPerPage,proto3" json:"result_per_page,omitempty"`
}

func (x *SearchRequest) Reset() {
	*x = SearchRequest{}
	if protoimpl.UnsafeEnabled {
		mi := &file_search_service_proto_msgTypes[0]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *SearchRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*SearchRequest) ProtoMessage() {}

func (x *SearchRequest) ProtoReflect() protoreflect.Message {
	mi := &file_search_service_proto_msgTypes[0]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use SearchRequest.ProtoReflect.Descriptor instead.
func (*SearchRequest) Descriptor() ([]byte, []int) {
	return file_search_service_proto_rawDescGZIP(), []int{0}
}

func (x *SearchRequest) GetQuery() string {
	if x != nil {
		return x.Query
	}
	return ""
}

func (x *SearchRequest) GetPageNumber() int32 {
	if x != nil {
		return x.PageNumber
	}
	return 0
}

func (x *SearchRequest) GetResultPerPage() int32 {
	if x != nil {
		return x.ResultPerPage
	}
	return 0
}

type SearchResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Results []*Result `protobuf:"bytes,1,rep,name=results,proto3" json:"results,omitempty"`
}

func (x *SearchResponse) Reset() {
	*x = SearchResponse{}
	if protoimpl.UnsafeEnabled {
		mi := &file_search_service_proto_msgTypes[1]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *SearchResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*SearchResponse) ProtoMessage() {}

func (x *SearchResponse) ProtoReflect() protoreflect.Message {
	mi := &file_search_service_proto_msgTypes[1]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use SearchResponse.ProtoReflect.Descriptor instead.
func (*SearchResponse) Descriptor() ([]byte, []int) {
	return file_search_service_proto_rawDescGZIP(), []int{1}
}

func (x *SearchResponse) GetResults() []*Result {
	if x != nil {
		return x.Results
	}
	return nil
}

type Result struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Url      string   `protobuf:"bytes,1,opt,name=url,proto3" json:"url,omitempty"`
	Title    string   `protobuf:"bytes,2,opt,name=title,proto3" json:"title,omitempty"`
	Snippets []string `protobuf:"bytes,3,rep,name=snippets,proto3" json:"snippets,omitempty"`
	IsAd     bool     `protobuf:"varint,4,opt,name=is_ad,json=isAd,proto3" json:"is_ad,omitempty"`
}

func (x *Result) Reset() {
	*x = Result{}
	if protoimpl.UnsafeEnabled {
		mi := &file_search_service_proto_msgTypes[2]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *Result) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*Result) ProtoMessage() {}

func (x *Result) ProtoReflect() protoreflect.Message {
	mi := &file_search_service_proto_msgTypes[2]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use Result.ProtoReflect.Descriptor instead.
func (*Result) Descriptor() ([]byte, []int) {
	return file_search_service_proto_rawDescGZIP(), []int{2}
}

func (x *Result) GetUrl() string {
	if x != nil {
		return x.Url
	}
	return ""
}

func (x *Result) GetTitle() string {
	if x != nil {
		return x.Title
	}
	return ""
}

func (x *Result) GetSnippets() []string {
	if x != nil {
		return x.Snippets
	}
	return nil
}

func (x *Result) GetIsAd() bool {
	if x != nil {
		return x.IsAd
	}
	return false
}

type IndexRequest struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Result           *Result  `protobuf:"bytes,1,opt,name=result,proto3" json:"result,omitempty"`
	Position         Position `protobuf:"varint,2,opt,name=position,proto3,enum=Position" json:"position,omitempty"`
	AdditionalCopies uint64   `protobuf:"varint,3,opt,name=additional_copies,json=additionalCopies,proto3" json:"additional_copies,omitempty"`
}

func (x *IndexRequest) Reset() {
	*x = IndexRequest{}
	if protoimpl.UnsafeEnabled {
		mi := &file_search_service_proto_msgTypes[3]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *IndexRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*IndexRequest) ProtoMessage() {}

func (x *IndexRequest) ProtoReflect() protoreflect.Message {
	mi := &file_search_service_proto_msgTypes[3]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use IndexRequest.ProtoReflect.Descriptor instead.
func (*IndexRequest) Descriptor() ([]byte, []int) {
	return file_search_service_proto_rawDescGZIP(), []int{3}
}

func (x *IndexRequest) GetResult() *Result {
	if x != nil {
		return x.Result
	}
	return nil
}

func (x *IndexRequest) GetPosition() Position {
	if x != nil {
		return x.Position
	}
	return Position_POSITION_TOP
}

func (x *IndexRequest) GetAdditionalCopies() uint64 {
	if x != nil {
		return x.AdditionalCopies
	}
	return 0
}

type IndexResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Result *Result `protobuf:"bytes,1,opt,name=result,proto3" json:"result,omitempty"`
}

func (x *IndexResponse) Reset() {
	*x = IndexResponse{}
	if protoimpl.UnsafeEnabled {
		mi := &file_search_service_proto_msgTypes[4]
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		ms.StoreMessageInfo(mi)
	}
}

func (x *IndexResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*IndexResponse) ProtoMessage() {}

func (x *IndexResponse) ProtoReflect() protoreflect.Message {
	mi := &file_search_service_proto_msgTypes[4]
	if protoimpl.UnsafeEnabled && x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use IndexResponse.ProtoReflect.Descriptor instead.
func (*IndexResponse) Descriptor() ([]byte, []int) {
	return file_search_service_proto_rawDescGZIP(), []int{4}
}

func (x *IndexResponse) GetResult() *Result {
	if x != nil {
		return x.Result
	}
	return nil
}

var File_search_service_proto protoreflect.FileDescriptor

var file_search_service_proto_rawDesc = []byte{
	0x0a, 0x14, 0x73, 0x65, 0x61, 0x72, 0x63, 0x68, 0x2d, 0x73, 0x65, 0x72, 0x76, 0x69, 0x63, 0x65,
	0x2e, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x22, 0x6e, 0x0a, 0x0d, 0x53, 0x65, 0x61, 0x72, 0x63, 0x68,
	0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x12, 0x14, 0x0a, 0x05, 0x71, 0x75, 0x65, 0x72, 0x79,
	0x18, 0x01, 0x20, 0x01, 0x28, 0x09, 0x52, 0x05, 0x71, 0x75, 0x65, 0x72, 0x79, 0x12, 0x1f, 0x0a,
	0x0b, 0x70, 0x61, 0x67, 0x65, 0x5f, 0x6e, 0x75, 0x6d, 0x62, 0x65, 0x72, 0x18, 0x02, 0x20, 0x01,
	0x28, 0x05, 0x52, 0x0a, 0x70, 0x61, 0x67, 0x65, 0x4e, 0x75, 0x6d, 0x62, 0x65, 0x72, 0x12, 0x26,
	0x0a, 0x0f, 0x72, 0x65, 0x73, 0x75, 0x6c, 0x74, 0x5f, 0x70, 0x65, 0x72, 0x5f, 0x70, 0x61, 0x67,
	0x65, 0x18, 0x03, 0x20, 0x01, 0x28, 0x05, 0x52, 0x0d, 0x72, 0x65, 0x73, 0x75, 0x6c, 0x74, 0x50,
	0x65, 0x72, 0x50, 0x61, 0x67, 0x65, 0x22, 0x33, 0x0a, 0x0e, 0x53, 0x65, 0x61, 0x72, 0x63, 0x68,
	0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65, 0x12, 0x21, 0x0a, 0x07, 0x72, 0x65, 0x73, 0x75,
	0x6c, 0x74, 0x73, 0x18, 0x01, 0x20, 0x03, 0x28, 0x0b, 0x32, 0x07, 0x2e, 0x52, 0x65, 0x73, 0x75,
	0x6c, 0x74, 0x52, 0x07, 0x72, 0x65, 0x73, 0x75, 0x6c, 0x74, 0x73, 0x22, 0x61, 0x0a, 0x06, 0x52,
	0x65, 0x73, 0x75, 0x6c, 0x74, 0x12, 0x10, 0x0a, 0x03, 0x75, 0x72, 0x6c, 0x18, 0x01, 0x20, 0x01,
	0x28, 0x09, 0x52, 0x03, 0x75, 0x72, 0x6c, 0x12, 0x14, 0x0a, 0x05, 0x74, 0x69, 0x74, 0x6c, 0x65,
	0x18, 0x02, 0x20, 0x01, 0x28, 0x09, 0x52, 0x05, 0x74, 0x69, 0x74, 0x6c, 0x65, 0x12, 0x1a, 0x0a,
	0x08, 0x73, 0x6e, 0x69, 0x70, 0x70, 0x65, 0x74, 0x73, 0x18, 0x03, 0x20, 0x03, 0x28, 0x09, 0x52,
	0x08, 0x73, 0x6e, 0x69, 0x70, 0x70, 0x65, 0x74, 0x73, 0x12, 0x13, 0x0a, 0x05, 0x69, 0x73, 0x5f,
	0x61, 0x64, 0x18, 0x04, 0x20, 0x01, 0x28, 0x08, 0x52, 0x04, 0x69, 0x73, 0x41, 0x64, 0x22, 0x83,
	0x01, 0x0a, 0x0c, 0x49, 0x6e, 0x64, 0x65, 0x78, 0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x12,
	0x1f, 0x0a, 0x06, 0x72, 0x65, 0x73, 0x75, 0x6c, 0x74, 0x18, 0x01, 0x20, 0x01, 0x28, 0x0b, 0x32,
	0x07, 0x2e, 0x52, 0x65, 0x73, 0x75, 0x6c, 0x74, 0x52, 0x06, 0x72, 0x65, 0x73, 0x75, 0x6c, 0x74,
	0x12, 0x25, 0x0a, 0x08, 0x70, 0x6f, 0x73, 0x69, 0x74, 0x69, 0x6f, 0x6e, 0x18, 0x02, 0x20, 0x01,
	0x28, 0x0e, 0x32, 0x09, 0x2e, 0x50, 0x6f, 0x73, 0x69, 0x74, 0x69, 0x6f, 0x6e, 0x52, 0x08, 0x70,
	0x6f, 0x73, 0x69, 0x74, 0x69, 0x6f, 0x6e, 0x12, 0x2b, 0x0a, 0x11, 0x61, 0x64, 0x64, 0x69, 0x74,
	0x69, 0x6f, 0x6e, 0x61, 0x6c, 0x5f, 0x63, 0x6f, 0x70, 0x69, 0x65, 0x73, 0x18, 0x03, 0x20, 0x01,
	0x28, 0x04, 0x52, 0x10, 0x61, 0x64, 0x64, 0x69, 0x74, 0x69, 0x6f, 0x6e, 0x61, 0x6c, 0x43, 0x6f,
	0x70, 0x69, 0x65, 0x73, 0x22, 0x30, 0x0a, 0x0d, 0x49, 0x6e, 0x64, 0x65, 0x78, 0x52, 0x65, 0x73,
	0x70, 0x6f, 0x6e, 0x73, 0x65, 0x12, 0x1f, 0x0a, 0x06, 0x72, 0x65, 0x73, 0x75, 0x6c, 0x74, 0x18,
	0x01, 0x20, 0x01, 0x28, 0x0b, 0x32, 0x07, 0x2e, 0x52, 0x65, 0x73, 0x75, 0x6c, 0x74, 0x52, 0x06,
	0x72, 0x65, 0x73, 0x75, 0x6c, 0x74, 0x2a, 0x31, 0x0a, 0x08, 0x50, 0x6f, 0x73, 0x69, 0x74, 0x69,
	0x6f, 0x6e, 0x12, 0x10, 0x0a, 0x0c, 0x50, 0x4f, 0x53, 0x49, 0x54, 0x49, 0x4f, 0x4e, 0x5f, 0x54,
	0x4f, 0x50, 0x10, 0x00, 0x12, 0x13, 0x0a, 0x0f, 0x50, 0x4f, 0x53, 0x49, 0x54, 0x49, 0x4f, 0x4e,
	0x5f, 0x42, 0x4f, 0x54, 0x54, 0x4f, 0x4d, 0x10, 0x01, 0x32, 0x62, 0x0a, 0x0d, 0x53, 0x65, 0x61,
	0x72, 0x63, 0x68, 0x53, 0x65, 0x72, 0x76, 0x69, 0x63, 0x65, 0x12, 0x29, 0x0a, 0x06, 0x53, 0x65,
	0x61, 0x72, 0x63, 0x68, 0x12, 0x0e, 0x2e, 0x53, 0x65, 0x61, 0x72, 0x63, 0x68, 0x52, 0x65, 0x71,
	0x75, 0x65, 0x73, 0x74, 0x1a, 0x0f, 0x2e, 0x53, 0x65, 0x61, 0x72, 0x63, 0x68, 0x52, 0x65, 0x73,
	0x70, 0x6f, 0x6e, 0x73, 0x65, 0x12, 0x26, 0x0a, 0x05, 0x49, 0x6e, 0x64, 0x65, 0x78, 0x12, 0x0d,
	0x2e, 0x49, 0x6e, 0x64, 0x65, 0x78, 0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x1a, 0x0e, 0x2e,
	0x49, 0x6e, 0x64, 0x65, 0x78, 0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65, 0x42, 0x13, 0x5a,
	0x11, 0x69, 0x6e, 0x74, 0x65, 0x72, 0x6e, 0x61, 0x6c, 0x2f, 0x64, 0x65, 0x6d, 0x6f, 0x2d, 0x61,
	0x70, 0x70, 0x62, 0x06, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x33,
}

var (
	file_search_service_proto_rawDescOnce sync.Once
	file_search_service_proto_rawDescData = file_search_service_proto_rawDesc
)

func file_search_service_proto_rawDescGZIP() []byte {
	file_search_service_proto_rawDescOnce.Do(func() {
		file_search_service_proto_rawDescData = protoimpl.X.CompressGZIP(file_search_service_proto_rawDescData)
	})
	return file_search_service_proto_rawDescData
}

var file_search_service_proto_enumTypes = make([]protoimpl.EnumInfo, 1)
var file_search_service_proto_msgTypes = make([]protoimpl.MessageInfo, 5)
var file_search_service_proto_goTypes = []interface{}{
	(Position)(0),          // 0: Position
	(*SearchRequest)(nil),  // 1: SearchRequest
	(*SearchResponse)(nil), // 2: SearchResponse
	(*Result)(nil),         // 3: Result
	(*IndexRequest)(nil),   // 4: IndexRequest
	(*IndexResponse)(nil),  // 5: IndexResponse
}
var file_search_service_proto_depIdxs = []int32{
	3, // 0: SearchResponse.results:type_name -> Result
	3, // 1: IndexRequest.result:type_name -> Result
	0, // 2: IndexRequest.position:type_name -> Position
	3, // 3: IndexResponse.result:type_name -> Result
	1, // 4: SearchService.Search:input_type -> SearchRequest
	4, // 5: SearchService.Index:input_type -> IndexRequest
	2, // 6: SearchService.Search:output_type -> SearchResponse
	5, // 7: SearchService.Index:output_type -> IndexResponse
	6, // [6:8] is the sub-list for method output_type
	4, // [4:6] is the sub-list for method input_type
	4, // [4:4] is the sub-list for extension type_name
	4, // [4:4] is the sub-list for extension extendee
	0, // [0:4] is the sub-list for field type_name
}

func init() { file_search_service_proto_init() }
func file_search_service_proto_init() {
	if File_search_service_proto != nil {
		return
	}
	if !protoimpl.UnsafeEnabled {
		file_search_service_proto_msgTypes[0].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*SearchRequest); i {
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
		file_search_service_proto_msgTypes[1].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*SearchResponse); i {
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
		file_search_service_proto_msgTypes[2].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*Result); i {
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
		file_search_service_proto_msgTypes[3].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*IndexRequest); i {
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
		file_search_service_proto_msgTypes[4].Exporter = func(v interface{}, i int) interface{} {
			switch v := v.(*IndexResponse); i {
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
			RawDescriptor: file_search_service_proto_rawDesc,
			NumEnums:      1,
			NumMessages:   5,
			NumExtensions: 0,
			NumServices:   1,
		},
		GoTypes:           file_search_service_proto_goTypes,
		DependencyIndexes: file_search_service_proto_depIdxs,
		EnumInfos:         file_search_service_proto_enumTypes,
		MessageInfos:      file_search_service_proto_msgTypes,
	}.Build()
	File_search_service_proto = out.File
	file_search_service_proto_rawDesc = nil
	file_search_service_proto_goTypes = nil
	file_search_service_proto_depIdxs = nil
}
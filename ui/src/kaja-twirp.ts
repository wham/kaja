import { TwirpFetchTransport } from "@protobuf-ts/twirp-transport";
import { QuirksClient } from "./quirks.client";
import { SearchServiceClient } from "./search-service.client";
export const model = {
  services: [
    {
      name: "Quirks",
      methods: [
        { name: "GetAuthentication", code: "Quirks.GetAuthentication();\n" },
        { name: "Map", code: "Quirks.Map();\n" },
        {
          name: "MethodWithAReallyLongNameGmthggupcbmnphflnnvu",
          code: "Quirks.MethodWithAReallyLongNameGmthggupcbmnphflnnvu();\n",
        },
        { name: "Panic", code: "Quirks.Panic();\n" },
        { name: "Repeated", code: "Quirks.Repeated();\n" },
        { name: "Types", code: "Quirks.Types();\n" },
      ],
      proxy: {
        GetAuthentication: async () => {
          var transport = new TwirpFetchTransport({
            baseUrl: "http://localhost:3000/twirp",
          });
          var client = new QuirksClient(transport);
          var { response } = await client.getAuthentication({} as any);
          (window as any).GOUT(response);
          return response;
        },
        Map: async () => {
          var transport = new TwirpFetchTransport({
            baseUrl: "http://localhost:3000/twirp",
          });
          var client = new QuirksClient(transport);
          var { response } = await client.map({} as any);
          (window as any).GOUT(response);
          return response;
        },
        MethodWithAReallyLongNameGmthggupcbmnphflnnvu: async () => {
          var transport = new TwirpFetchTransport({
            baseUrl: "http://localhost:3000/twirp",
          });
          var client = new QuirksClient(transport);
          var { response } =
            await client.methodWithAReallyLongNameGmthggupcbmnphflnnvu(
              {} as any
            );
          (window as any).GOUT(response);
          return response;
        },
        Panic: async () => {
          var transport = new TwirpFetchTransport({
            baseUrl: "http://localhost:3000/twirp",
          });
          var client = new QuirksClient(transport);
          var { response } = await client.panic({} as any);
          (window as any).GOUT(response);
          return response;
        },
        Repeated: async () => {
          var transport = new TwirpFetchTransport({
            baseUrl: "http://localhost:3000/twirp",
          });
          var client = new QuirksClient(transport);
          var { response } = await client.repeated({} as any);
          (window as any).GOUT(response);
          return response;
        },
        Types: async () => {
          var transport = new TwirpFetchTransport({
            baseUrl: "http://localhost:3000/twirp",
          });
          var client = new QuirksClient(transport);
          var { response } = await client.types({} as any);
          (window as any).GOUT(response);
          return response;
        },
      },
      extraLib:
        'const Quirks = { GetAuthentication: async () => { var transport = new TwirpFetchTransport({ baseUrl: "http://localhost:3000/twirp" }); var client = new QuirksClient(transport); var { response } = await client.getAuthentication(({} as any)); (window as any).GOUT(response); return response; }, Map: async () => { var transport = new TwirpFetchTransport({ baseUrl: "http://localhost:3000/twirp" }); var client = new QuirksClient(transport); var { response } = await client.map(({} as any)); (window as any).GOUT(response); return response; }, MethodWithAReallyLongNameGmthggupcbmnphflnnvu: async () => { var transport = new TwirpFetchTransport({ baseUrl: "http://localhost:3000/twirp" }); var client = new QuirksClient(transport); var { response } = await client.methodWithAReallyLongNameGmthggupcbmnphflnnvu(({} as any)); (window as any).GOUT(response); return response; }, Panic: async () => { var transport = new TwirpFetchTransport({ baseUrl: "http://localhost:3000/twirp" }); var client = new QuirksClient(transport); var { response } = await client.panic(({} as any)); (window as any).GOUT(response); return response; }, Repeated: async () => { var transport = new TwirpFetchTransport({ baseUrl: "http://localhost:3000/twirp" }); var client = new QuirksClient(transport); var { response } = await client.repeated(({} as any)); (window as any).GOUT(response); return response; }, Types: async () => { var transport = new TwirpFetchTransport({ baseUrl: "http://localhost:3000/twirp" }); var client = new QuirksClient(transport); var { response } = await client.types(({} as any)); (window as any).GOUT(response); return response; } };\n',
    },
    {
      name: "SearchService",
      methods: [
        { name: "Search", code: "SearchService.Search();\n" },
        { name: "Index", code: "SearchService.Index();\n" },
      ],
      proxy: {
        Search: async () => {
          var transport = new TwirpFetchTransport({
            baseUrl: "http://localhost:3000/twirp",
          });
          var client = new SearchServiceClient(transport);
          var { response } = await client.search({} as any);
          (window as any).GOUT(response);
          return response;
        },
        Index: async () => {
          var transport = new TwirpFetchTransport({
            baseUrl: "http://localhost:3000/twirp",
          });
          var client = new SearchServiceClient(transport);
          var { response } = await client.index({} as any);
          (window as any).GOUT(response);
          return response;
        },
      },
      extraLib:
        'const SearchService = { Search: async () => { var transport = new TwirpFetchTransport({ baseUrl: "http://localhost:3000/twirp" }); var client = new SearchServiceClient(transport); var { response } = await client.search(({} as any)); (window as any).GOUT(response); return response; }, Index: async () => { var transport = new TwirpFetchTransport({ baseUrl: "http://localhost:3000/twirp" }); var client = new SearchServiceClient(transport); var { response } = await client.index(({} as any)); (window as any).GOUT(response); return response; } };\n',
    },
  ],
  extraLibs: [
    { filePath: "google/protobuf/timestamp.proto.proto.ts", content: "" },
    {
      filePath: "quirks.proto.proto.ts",
      content:
        "/**\n * @generated from protobuf service quirks.v1.Quirks\n */\nexport interface IQuirksClient {\n    /**\n     * @generated from protobuf rpc: GetAuthentication(quirks.v1.Void) returns (quirks.v1.Message);\n     */\n    getAuthentication(input: Void, options?: RpcOptions): UnaryCall<Void, Message>;\n    /**\n     * @generated from protobuf rpc: Map(quirks.v1.MapRequest) returns (quirks.v1.MapRequest);\n     */\n    map(input: MapRequest, options?: RpcOptions): UnaryCall<MapRequest, MapRequest>;\n    /**\n     * @generated from protobuf rpc: MethodWithAReallyLongNameGmthggupcbmnphflnnvu(quirks.v1.Void) returns (quirks.v1.Message);\n     */\n    methodWithAReallyLongNameGmthggupcbmnphflnnvu(input: Void, options?: RpcOptions): UnaryCall<Void, Message>;\n    /**\n     * @generated from protobuf rpc: Panic(quirks.v1.Void) returns (quirks.v1.Message);\n     */\n    panic(input: Void, options?: RpcOptions): UnaryCall<Void, Message>;\n    /**\n     * @generated from protobuf rpc: Repeated(quirks.v1.RepeatedRequest) returns (quirks.v1.RepeatedRequest);\n     */\n    repeated(input: RepeatedRequest, options?: RpcOptions): UnaryCall<RepeatedRequest, RepeatedRequest>;\n    /**\n     * @generated from protobuf rpc: Types(quirks.v1.TypesRequest) returns (quirks.v1.TypesRequest);\n     */\n    types(input: TypesRequest, options?: RpcOptions): UnaryCall<TypesRequest, TypesRequest>;\n}\n",
    },
    {
      filePath: "search-service.proto.proto.ts",
      content:
        "/**\n * @generated from protobuf service SearchService\n */\nexport interface ISearchServiceClient {\n    /**\n     * @generated from protobuf rpc: Search(SearchRequest) returns (SearchResponse);\n     */\n    search(input: SearchRequest, options?: RpcOptions): UnaryCall<SearchRequest, SearchResponse>;\n    /**\n     * @generated from protobuf rpc: Index(IndexRequest) returns (IndexResponse);\n     */\n    index(input: IndexRequest, options?: RpcOptions): UnaryCall<IndexRequest, IndexResponse>;\n}\n",
    },
  ],
};

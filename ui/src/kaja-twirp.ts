export const model = {
  services: [
    {
      name: "Quirks",
      methods: [
        {
          name: "GetAuthentication",
          code: 'let transport = new TwirpFetchTransport({ baseUrl: "http://localhost:3000/twirp" });\nlet client = new QuirksClient(transport);\nvar { response } = client.GetAuthentication();\nGOUT(JSON.stringify(response));\n',
        },
        {
          name: "Map",
          code: 'let transport = new TwirpFetchTransport({ baseUrl: "http://localhost:3000/twirp" });\nlet client = new QuirksClient(transport);\nvar { response } = client.Map();\nGOUT(JSON.stringify(response));\n',
        },
        {
          name: "MethodWithAReallyLongNameGmthggupcbmnphflnnvu",
          code: 'let transport = new TwirpFetchTransport({ baseUrl: "http://localhost:3000/twirp" });\nlet client = new QuirksClient(transport);\nvar { response } = client.MethodWithAReallyLongNameGmthggupcbmnphflnnvu();\nGOUT(JSON.stringify(response));\n',
        },
        {
          name: "Panic",
          code: 'let transport = new TwirpFetchTransport({ baseUrl: "http://localhost:3000/twirp" });\nlet client = new QuirksClient(transport);\nvar { response } = client.Panic();\nGOUT(JSON.stringify(response));\n',
        },
        {
          name: "Repeated",
          code: 'let transport = new TwirpFetchTransport({ baseUrl: "http://localhost:3000/twirp" });\nlet client = new QuirksClient(transport);\nvar { response } = client.Repeated();\nGOUT(JSON.stringify(response));\n',
        },
        {
          name: "Types",
          code: 'let transport = new TwirpFetchTransport({ baseUrl: "http://localhost:3000/twirp" });\nlet client = new QuirksClient(transport);\nvar { response } = client.Types();\nGOUT(JSON.stringify(response));\n',
        },
      ],
    },
    {
      name: "SearchService",
      methods: [
        {
          name: "Search",
          code: 'let transport = new TwirpFetchTransport({ baseUrl: "http://localhost:3000/twirp" });\nlet client = new SearchServiceClient(transport);\nvar { response } = client.Search();\nGOUT(JSON.stringify(response));\n',
        },
        {
          name: "Index",
          code: 'let transport = new TwirpFetchTransport({ baseUrl: "http://localhost:3000/twirp" });\nlet client = new SearchServiceClient(transport);\nvar { response } = client.Index();\nGOUT(JSON.stringify(response));\n',
        },
      ],
    },
  ],
  extraLibs: [
    "export const Quirks = { GetAuthentication: hello => 2, Map: hello => 2, MethodWithAReallyLongNameGmthggupcbmnphflnnvu: hello => 2, Panic: hello => 2, Repeated: hello => 2, Types: hello => 2 };\n",
    "export const SearchService = { Search: hello => 2, Index: hello => 2 };\n",
  ],
};

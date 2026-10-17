package kaja

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wham/protoc-go/protoc"
)

const shop = `syntax = "proto3";
package kaja;

import "google/protobuf/descriptor.proto";

enum HttpPayload {
  HTTP_PAYLOAD_UNSPECIFIED = 0;
  HTTP_PAYLOAD_ITEMS = 2;
}

extend google.protobuf.FieldOptions {
  HttpPayload http_payload = 79001;
  string http_in = 79002;
  bool http_required = 79003;
  repeated string enum_values = 79004;
}

// A thing for sale.
message Item {
  // Where the item is listed.
  string id = 1 [(http_required) = true];
  oneof price {
    int32 cents = 2;
  }
  string page = 3 [(http_in) = "query"];
  repeated Item items = 4 [(http_payload) = HTTP_PAYLOAD_ITEMS];
  string state = 5 [(enum_values) = "onSale", (enum_values) = "cancelled"];
  map<string, Kind> kinds = 6;
}

enum Kind {
  KIND_UNSPECIFIED = 0;
  KIND_BOOK = 1;
}

service Catalog {
  // Reads one item.
  rpc GetItem(Item) returns (Item);
  rpc Upload(stream Item) returns (Item);
  rpc Watch(Item) returns (stream Item);
}

service Orders {
  // Places an order.
  rpc Place(Item) returns (Item) {
    option deprecated = true;
  }
}
`

func generate(t *testing.T, parameter string, files map[string]string, compile ...string) map[string]string {
	t.Helper()
	dir := t.TempDir()
	for name, content := range files {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	result, err := protoc.New(protoc.WithProtoPaths(dir)).Compile(compile...)
	if err != nil {
		t.Fatal(err)
	}
	generated, err := result.RunLibraryPlugin(NewPlugin(), parameter)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, f := range generated {
		out[f.Name] = f.Content
	}
	return out
}

func readManifest(t *testing.T, files map[string]string) map[string]*moduleManifest {
	t.Helper()
	var m manifest
	if err := json.Unmarshal([]byte(files[ManifestName]), &m); err != nil {
		t.Fatalf("manifest: %v", err)
	}
	modules := map[string]*moduleManifest{}
	for _, module := range m.Modules {
		modules[module.Path] = module
	}
	return modules
}

func shopModule(t *testing.T) *moduleManifest {
	t.Helper()
	return readManifest(t, generate(t, "kaja_manifest", map[string]string{"shop.proto": shop}, "shop.proto"))["shop.ts"]
}

func TestTheManifestIsAllAnAppCompilesTo(t *testing.T) {
	files := generate(t, "kaja_manifest", map[string]string{"shop.proto": shop}, "shop.proto")
	if len(files) != 1 || files[ManifestName] == "" {
		t.Fatalf("generated %v", keys(files))
	}
}

func TestWithoutTheParameterAFileIsAModule(t *testing.T) {
	files := generate(t, "", map[string]string{"shop.proto": shop}, "shop.proto")
	module := files["shop.ts"]
	if len(files) != 1 || module == "" {
		t.Fatalf("generated %v", keys(files))
	}
	for _, want := range []string{
		`import { MessageType } from "@protobuf-ts/runtime";`,
		`export const Item: MessageType<Item> = new MessageType<Item>("kaja.Item", [`,
		`{ no: 1, name: "id", kind: "scalar", T: 9, options: {"kaja.http_required":true} }`,
		`{ no: 6, name: "kinds", kind: "map", K: 9, V: { kind: "enum", T: () => ["kaja.Kind", Kind, "KIND_"] } }`,
		`{ name: "Upload", clientStreaming: true, options: {}, I: Item, O: Item }`,
		"export class CatalogClient {",
		`return stackIntercept<Item, Item>("clientStreaming", this.#transport, Catalog.methods[1], this.#transport.mergeOptions(options));`,
	} {
		if !strings.Contains(module, want) {
			t.Errorf("shop.ts is missing %q:\n%s", want, module)
		}
	}
}

func TestEveryServiceInAModuleIsADeclaredConst(t *testing.T) {
	module := shopModule(t)
	for _, want := range []string{
		`import type { Call, CallOptions, Input } from "kaja";`,
		"export declare const Catalog: {\n    /**\n     * Reads one item.\n     */\n    GetItem(input: Input<Item>, options?: CallOptions): Call<Item>;\n",
		"    Watch(input: Input<Item>, options?: CallOptions): Call<Item>;\n};",
		"export declare const Orders: {\n    /**\n     * Places an order.\n     *\n     * @deprecated\n     */\n    Place(input: Input<Item>, options?: CallOptions): Call<Item>;\n};",
	} {
		if !strings.Contains(module.EditorText, want) {
			t.Errorf("editor text is missing %q:\n%s", want, module.EditorText)
		}
	}
	if strings.Contains(module.EditorText, "Upload") {
		t.Errorf("a method streaming from the client reached the editor text:\n%s", module.EditorText)
	}
}

func TestMethodsCarryWhatTheTreeShows(t *testing.T) {
	module := shopModule(t)
	if len(module.Services) != 2 {
		t.Fatalf("services: %+v", module.Services)
	}
	catalog, orders := module.Services[0], module.Services[1]
	if catalog.TypeName != "kaja.Catalog" || len(catalog.Methods) != 3 {
		t.Fatalf("catalog: %+v", catalog)
	}
	get := catalog.Methods[0]
	if get.Name != "GetItem" || get.Input != "Item" || get.I != "kaja.Item" || get.O != "kaja.Item" || get.Doc != "Reads one item." {
		t.Errorf("GetItem: %+v", get)
	}
	if !catalog.Methods[1].ClientStreaming || !catalog.Methods[2].ServerStreaming {
		t.Errorf("streaming: %+v %+v", catalog.Methods[1], catalog.Methods[2])
	}
	if len(orders.Methods) != 1 || !orders.Methods[0].Deprecated || orders.Methods[0].Doc != "Places an order." {
		t.Errorf("orders methods: %+v", orders.Methods)
	}
}

func TestFieldsAreWhatTheRuntimeReads(t *testing.T) {
	module := shopModule(t)
	var item *messageManifest
	for _, msg := range module.Messages {
		if msg.TypeName == "kaja.Item" {
			item = msg
		}
	}
	if item == nil {
		t.Fatalf("messages: %+v", module.Messages)
	}
	encoded, err := json.Marshal(item.Fields)
	if err != nil {
		t.Fatal(err)
	}
	want := `[{"no":1,"name":"id","kind":"scalar","T":9,"options":{"kaja.http_required":true}},` +
		`{"no":2,"name":"cents","kind":"scalar","oneof":"price","T":5},` +
		`{"no":3,"name":"page","kind":"scalar","T":9,"options":{"kaja.http_in":"query"}},` +
		`{"no":4,"name":"items","kind":"message","repeat":2,"T":"kaja.Item","options":{"kaja.http_payload":"HTTP_PAYLOAD_ITEMS"}},` +
		`{"no":5,"name":"state","kind":"scalar","T":9,"options":{"kaja.enum_values":["onSale","cancelled"]}},` +
		`{"no":6,"name":"kinds","kind":"map","K":9,"V":{"kind":"enum","T":"kaja.Kind"}}]`
	if string(encoded) != want {
		t.Errorf("fields:\n%s\nwant\n%s", encoded, want)
	}

	for _, e := range module.Enums {
		if e.TypeName == "kaja.Kind" {
			values, _ := json.Marshal(e.Values)
			if e.Name != "Kind" || e.Prefix != "KIND_" || string(values) != `[["UNSPECIFIED",0],["BOOK",1]]` {
				t.Errorf("Kind: %+v %s", e, values)
			}
		}
	}
}

func TestDeclarationsFoldTheMarksIn(t *testing.T) {
	module := shopModule(t)
	declarations := map[string]*declaration{}
	for _, d := range module.Declarations {
		declarations[d.Name] = d
	}
	item := declarations["Item"]
	if item == nil || !strings.HasPrefix(item.Text, "/** A thing for sale. */\nexport interface Item {\n    /** Where the item is listed. [required] */\n    id: string;\n    price: {") {
		t.Fatalf("Item: %+v", item)
	}
	for _, mark := range []string{
		"    /** [query parameter] */\n    page: string;",
		"    /** [carries the HTTP payload] */\n    items: Item[];",
		"    /** [one of: onSale, cancelled] */\n    state: string;",
		"    kinds: { [key: string]: Kind };",
	} {
		if !strings.Contains(item.Text, mark) {
			t.Errorf("Item is missing %q:\n%s", mark, item.Text)
		}
	}
	if strings.Join(item.References, ",") != "Item,Kind" {
		t.Errorf("references: %v", item.References)
	}
	if kind := declarations["Kind"]; kind == nil || kind.Text != "export enum Kind {\n    UNSPECIFIED = 0,\n    BOOK = 1,\n}" {
		t.Errorf("Kind: %+v", kind)
	}
}

func TestAnImportTakenByAnotherNameIsNumbered(t *testing.T) {
	files := map[string]string{
		"a.proto": `syntax = "proto3"; package a; message Shared { string id = 1; }`,
		"b.proto": `syntax = "proto3"; package b; message Shared { int32 id = 1; }`,
		"main.proto": `syntax = "proto3"; package main;
import "a.proto";
import "b.proto";
message Input { a.Shared first = 1; b.Shared second = 2; }
service Shared { rpc Get(Input) returns (Input); }`,
	}
	module := readManifest(t, generate(t, "kaja_manifest", files, "main.proto"))["main.ts"]
	for _, want := range []string{
		`import type { Call, CallOptions, Input as Input$ } from "kaja";`,
		`import type { Shared as Shared$ } from "./a";`,
		`import type { Shared as Shared$2 } from "./b";`,
		"    first?: Shared$;\n    second?: Shared$2;",
		"Get(input: Input$<Input>, options?: CallOptions): Call<Input>;",
	} {
		if !strings.Contains(module.EditorText, want) {
			t.Errorf("editor text is missing %q:\n%s", want, module.EditorText)
		}
	}
}

func TestOnlyTheFilesAModuleReachesAreModules(t *testing.T) {
	files := map[string]string{
		"used.proto":   `syntax = "proto3"; message Used {}`,
		"unused.proto": `syntax = "proto3"; message Unused {}`,
		"main.proto": `syntax = "proto3";
import "used.proto";
import "unused.proto";
message Main { Used used = 1; }`,
	}
	modules := readManifest(t, generate(t, "kaja_manifest", files, "main.proto"))
	if modules["main.ts"] == nil || modules["used.ts"] == nil || modules["unused.ts"] != nil {
		t.Errorf("modules: %v", keys(modules))
	}
}

func TestDocIsCutAtTwoHundredUnits(t *testing.T) {
	long := strings.Repeat("é", 250)
	if got := briefText(long, nil); got != strings.Repeat("é", maxDoc)+"…" {
		t.Errorf("got %d runes", len([]rune(got)))
	}
}

func keys[V any](m map[string]V) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}

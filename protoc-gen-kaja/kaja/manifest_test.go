package kaja

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wham/protoc-go/protoc"
)

const twoServices = `syntax = "proto3";
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

func generateManifest(t *testing.T, parameter string) map[string]string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "shop.proto"), []byte(twoServices), 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := protoc.New(protoc.WithProtoPaths(dir)).Compile("shop.proto")
	if err != nil {
		t.Fatal(err)
	}
	files, err := result.RunLibraryPlugin(NewPlugin(), parameter)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, f := range files {
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

func TestNoManifestWithoutTheParameter(t *testing.T) {
	if _, ok := generateManifest(t, "")[ManifestName]; ok {
		t.Fatal("a manifest was written without kaja_manifest")
	}
}

func TestManifestLeavesTheSourcesAlone(t *testing.T) {
	with := generateManifest(t, "kaja_manifest")
	without := generateManifest(t, "")
	for name, content := range without {
		if with[name] != content {
			t.Errorf("%s differs with the manifest on", name)
		}
	}
}

func TestEveryServiceInAModuleIsAConst(t *testing.T) {
	module := readManifest(t, generateManifest(t, "kaja_manifest"))["shop.ts"]
	for _, want := range []string{
		`import type { Call, CallOptions, Input } from "kaja";`,
		"export const Catalog = {\n    /**\n     * Reads one item.\n     *\n     * @generated from protobuf rpc: GetItem\n     */\n    GetItem: (input: Input<Item>, options?: CallOptions): Call<Item> => { },\n",
		"export const Orders = {\n",
		"    Place: (input: Input<Item>, options?: CallOptions): Call<Item> => { }\n};",
		"    Watch: (input: Input<Item>, options?: CallOptions): Call<Item> => { }\n};",
	} {
		if !strings.Contains(module.EditorText, want) {
			t.Errorf("editor text is missing %q:\n%s", want, module.EditorText)
		}
	}
	if strings.Contains(module.EditorText, "Upload") {
		t.Errorf("a method streaming from the client reached the editor text:\n%s", module.EditorText)
	}
	if strings.Contains(module.EditorText, "@generated from protobuf message") {
		t.Errorf("the types kept their comments:\n%s", module.EditorText)
	}
}

func TestMethodsCarryTheirDocAndDeprecation(t *testing.T) {
	module := readManifest(t, generateManifest(t, "kaja_manifest"))["shop.ts"]
	if len(module.Services) != 2 {
		t.Fatalf("services: %+v", module.Services)
	}
	catalog, orders := module.Services[0], module.Services[1]
	if catalog.TypeName != "kaja.Catalog" || catalog.ClientModule != "shop.client.ts" {
		t.Errorf("catalog: %+v", catalog)
	}
	if len(catalog.Methods) != 2 || *catalog.Methods[0] != (methodManifest{Name: "GetItem", Input: "Item", Output: "Item", Doc: "Reads one item."}) {
		t.Errorf("catalog methods: %+v", catalog.Methods)
	}
	if len(orders.Methods) != 1 || !orders.Methods[0].Deprecated || orders.Methods[0].Doc != "Places an order." {
		t.Errorf("orders methods: %+v", orders.Methods)
	}
}

func TestDeclarationsFoldTheMarksIn(t *testing.T) {
	module := readManifest(t, generateManifest(t, "kaja_manifest"))["shop.ts"]
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
	} {
		if !strings.Contains(item.Text, mark) {
			t.Errorf("Item is missing %q:\n%s", mark, item.Text)
		}
	}
	if strings.Join(item.References, ",") != "oneofKind,cents,Item" {
		t.Errorf("references: %v", item.References)
	}
	if kind := declarations["Kind"]; kind == nil || kind.Text != "export enum Kind {\n    UNSPECIFIED = 0,\n    BOOK = 1,\n}" {
		t.Errorf("Kind: %+v", kind)
	}
	if strings.Join(module.Interfaces, ",") != "Item" || strings.Join(module.Enums, ",") != "HttpPayload,Kind" {
		t.Errorf("interfaces %v, enums %v", module.Interfaces, module.Enums)
	}
}

func TestDocIsCutAtTwoHundredUnits(t *testing.T) {
	long := strings.Repeat("é", 250)
	if got := docText("/** " + long + " */"); got != strings.Repeat("é", maxDoc)+"…" {
		t.Errorf("got %d runes", len([]rune(got)))
	}
}

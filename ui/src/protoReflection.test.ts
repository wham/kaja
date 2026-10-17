import { describe, expect, it } from "bun:test";
import { buildReflection } from "./protoReflection";
import type { ModuleManifest } from "./sources";

const modules: ModuleManifest[] = [
  {
    path: "tree.ts",
    editorText: "",
    messages: [
      {
        name: "Node",
        typeName: "tree.Node",
        fields: [
          { no: 1, name: "name", kind: "scalar", T: 9 },
          { no: 2, name: "children", kind: "message", repeat: 2, T: "tree.Node" },
          { no: 3, name: "color", kind: "enum", T: "tree.Color" },
          { no: 4, name: "labels", kind: "map", K: 9, V: { kind: "enum", T: "tree.Color" } },
        ],
      },
    ],
    enums: [
      {
        name: "Color",
        typeName: "tree.Color",
        values: [
          ["UNSPECIFIED", 0],
          ["RED", 1],
        ],
        prefix: "COLOR_",
      },
    ],
    services: [
      {
        name: "Trees",
        typeName: "tree.Trees",
        methods: [{ name: "Grow", input: "Node", output: "Node", I: "tree.Node", O: "tree.Node", serverStreaming: true }],
      },
    ],
    declarations: [],
  },
];

describe("buildReflection", () => {
  it("builds an enum the way TypeScript declares one, shared by every field naming it", () => {
    const reflection = buildReflection(modules);
    const color = reflection.enums.get("tree.Color")!;
    expect(color).toEqual({ UNSPECIFIED: 0, RED: 1, 0: "UNSPECIFIED", 1: "RED" });

    const field = reflection.messages.get("tree.Node")!.fields.find((f) => f.name === "color")!;
    expect(field.kind === "enum" && field.T()).toEqual(["tree.Color", color, "COLOR_"]);
    expect(field.kind === "enum" && field.T()[1]).toBe(color);
  });

  it("encodes what it builds, a message naming itself included", () => {
    const node = buildReflection(modules).messages.get("tree.Node")!;
    const value = node.create({ name: "root", children: [{ name: "leaf", color: 1 }], labels: { a: 1 } });
    expect(node.fromBinary(node.toBinary(value))).toEqual(value);
  });

  it("makes a service of the methods, their types looked up by name", () => {
    const reflection = buildReflection(modules);
    const grow = reflection.services.get("tree.Trees")!.methods[0];
    expect(grow.I).toBe(reflection.messages.get("tree.Node")!);
    expect(grow.serverStreaming).toBe(true);
    expect(grow.localName).toBe("grow");
  });

  it("says which type it was never given", () => {
    const broken: ModuleManifest[] = [{ ...modules[0], messages: [] }];
    expect(() => buildReflection(broken)).toThrow("The app declares no message tree.Node");
  });
});

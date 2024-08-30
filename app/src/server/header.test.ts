import { expect, test } from "vitest";
import { parseHeader } from "./header";

test("parseHeader", () => {
  expect(parseHeader("Name: Value")).toEqual({ name: "Name", value: "Value" });
  expect(parseHeader("Name:Value")).toEqual({ name: "Name", value: "Value" });
  expect(parseHeader(" Name:  Value ")).toEqual({ name: "Name", value: "Value" });
  expect(parseHeader("Name")).toEqual({ name: "Name", value: "" });
  expect(parseHeader("Name:")).toEqual({ name: "Name", value: "" });
  expect(parseHeader(":Value")).toBeUndefined();
  expect(parseHeader("")).toBeUndefined();
});

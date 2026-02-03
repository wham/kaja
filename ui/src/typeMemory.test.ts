import { describe, it, expect, beforeEach } from "vitest";
import { IMessageType, ScalarType } from "@protobuf-ts/runtime";
import {
  captureValues,
  getTypeMemorizedValue,
  getScalarMemorizedValue,
  getScalarMemorizedValues,
  clearTypeMemory,
  getAllStoredTypes,
  getAllStoredScalars,
} from "./typeMemory";

// Helper to create a minimal mock message type for testing
function mockMessageType(typeName: string, fields: { name: string; scalarType: ScalarType }[]): IMessageType<any> {
  return {
    typeName,
    fields: fields.map((f, i) => ({
      no: i + 1,
      name: f.name,
      localName: f.name,
      kind: "scalar" as const,
      T: f.scalarType,
    })),
    // Minimal stubs for required methods
    create: () => ({}),
    fromBinary: () => ({}),
    toBinary: () => new Uint8Array(),
    fromJson: () => ({}),
    toJson: () => ({}),
    fromJsonString: () => ({}),
    toJsonString: () => "",
    clone: () => ({}),
    mergePartial: () => {},
    equals: () => true,
    is: () => true,
    isAssignable: () => true,
    options: {},
  } as unknown as IMessageType<any>;
}

describe("typeMemory", () => {
  beforeEach(() => {
    clearTypeMemory();
  });

  describe("captureValues with schema", () => {
    it("captures scalar values by protobuf type and field name", () => {
      const messageType = mockMessageType("example.Customer", [
        { name: "id", scalarType: ScalarType.STRING },
        { name: "name", scalarType: ScalarType.STRING },
        { name: "count", scalarType: ScalarType.INT32 },
        { name: "active", scalarType: ScalarType.BOOL },
      ]);

      captureValues("example.Customer", {
        id: "cust-123",
        name: "Acme Corp",
        count: 42,
        active: true,
      }, messageType);

      // Check scalar memory (field name + protobuf type)
      expect(getScalarMemorizedValue("id", ScalarType.STRING)).toBe("cust-123");
      expect(getScalarMemorizedValue("name", ScalarType.STRING)).toBe("Acme Corp");
      expect(getScalarMemorizedValue("count", ScalarType.INT32)).toBe(42);
      expect(getScalarMemorizedValue("active", ScalarType.BOOL)).toBe(true);

      // Check type memory (message type + field path)
      expect(getTypeMemorizedValue("example.Customer", "id")).toBe("cust-123");
      expect(getTypeMemorizedValue("example.Customer", "name")).toBe("Acme Corp");
    });

    it("returns most recently used value", () => {
      const messageType = mockMessageType("example.Customer", [
        { name: "id", scalarType: ScalarType.STRING },
      ]);

      captureValues("example.Customer", { id: "cust-1" }, messageType);
      captureValues("example.Customer", { id: "cust-2" }, messageType);
      captureValues("example.Customer", { id: "cust-3" }, messageType);

      // Most recent value should be returned
      expect(getScalarMemorizedValue("id", ScalarType.STRING)).toBe("cust-3");
      expect(getTypeMemorizedValue("example.Customer", "id")).toBe("cust-3");

      // Using an old value again makes it most recent
      captureValues("example.Customer", { id: "cust-1" }, messageType);
      expect(getScalarMemorizedValue("id", ScalarType.STRING)).toBe("cust-1");
    });
  });

  describe("captureValues without schema (type memory only)", () => {
    it("captures to type memory but not scalar memory", () => {
      captureValues("example.Customer", {
        id: "cust-123",
        name: "Acme Corp",
      });

      // Type memory should work
      expect(getTypeMemorizedValue("example.Customer", "id")).toBe("cust-123");
      expect(getTypeMemorizedValue("example.Customer", "name")).toBe("Acme Corp");

      // Scalar memory should be empty (no schema = no protobuf type info)
      expect(getAllStoredScalars()).toHaveLength(0);
    });

    it("captures nested object values to type memory", () => {
      captureValues("example.Order", {
        orderId: "order-456",
        customer: {
          id: "cust-789",
          name: "Test Customer",
        },
        total: 99.99,
      });

      // Type memory with paths
      expect(getTypeMemorizedValue("example.Order", "orderId")).toBe("order-456");
      expect(getTypeMemorizedValue("example.Order", "customer.id")).toBe("cust-789");
      expect(getTypeMemorizedValue("example.Order", "customer.name")).toBe("Test Customer");
    });

    it("captures array values to type memory", () => {
      captureValues("example.UserList", {
        users: [
          { id: "user-1", name: "Alice" },
          { id: "user-2", name: "Bob" },
        ],
      });

      // Type memory with array paths
      expect(getTypeMemorizedValue("example.UserList", "users[0].id")).toBe("user-1");
      expect(getTypeMemorizedValue("example.UserList", "users[0].name")).toBe("Alice");
      expect(getTypeMemorizedValue("example.UserList", "users[1].id")).toBe("user-2");
    });

    it("ignores null/undefined values", () => {
      captureValues("example.Customer", null);
      captureValues("example.Customer", undefined);

      expect(getAllStoredTypes()).toHaveLength(0);
      expect(getAllStoredScalars()).toHaveLength(0);
    });

    it("ignores empty type names", () => {
      captureValues("", { id: "test" });

      expect(getAllStoredTypes()).toHaveLength(0);
      expect(getAllStoredScalars()).toHaveLength(0);
    });
  });

  describe("scalar memory with protobuf types", () => {
    it("shares scalar values across different message types with same field name", () => {
      const responseType = mockMessageType("example.GetCustomerResponse", [
        { name: "id", scalarType: ScalarType.STRING },
        { name: "name", scalarType: ScalarType.STRING },
      ]);

      captureValues("example.GetCustomerResponse", {
        id: "cust-123",
        name: "Acme Corp",
      }, responseType);

      // The same "id" field name should be available for any STRING field named "id"
      expect(getScalarMemorizedValue("id", ScalarType.STRING)).toBe("cust-123");
      expect(getScalarMemorizedValue("name", ScalarType.STRING)).toBe("Acme Corp");
    });

    it("separates same field name with different protobuf types", () => {
      const typeA = mockMessageType("example.TypeA", [
        { name: "count", scalarType: ScalarType.INT32 },
      ]);
      const typeB = mockMessageType("example.TypeB", [
        { name: "count", scalarType: ScalarType.INT64 },
      ]);

      captureValues("example.TypeA", { count: 42 }, typeA);
      captureValues("example.TypeB", { count: "100" }, typeB);

      // Different protobuf scalar types are stored separately
      expect(getScalarMemorizedValue("count", ScalarType.INT32)).toBe(42);
      expect(getScalarMemorizedValue("count", ScalarType.INT64)).toBe("100");
    });
  });

  describe("getScalarMemorizedValues", () => {
    it("returns all memorized values for a field", () => {
      const messageType = mockMessageType("example.Customer", [
        { name: "id", scalarType: ScalarType.STRING },
      ]);

      captureValues("example.Customer", { id: "cust-1" }, messageType);
      captureValues("example.Customer", { id: "cust-2" }, messageType);
      captureValues("example.Customer", { id: "cust-3" }, messageType);

      const values = getScalarMemorizedValues("id", ScalarType.STRING);
      expect(values).toHaveLength(3);
      expect(values).toContain("cust-1");
      expect(values).toContain("cust-2");
      expect(values).toContain("cust-3");
    });

    it("returns empty array for non-existent field", () => {
      const values = getScalarMemorizedValues("nonExistent", ScalarType.STRING);
      expect(values).toEqual([]);
    });
  });

  describe("clearTypeMemory", () => {
    it("clears all memory", () => {
      const messageType = mockMessageType("example.Customer", [
        { name: "id", scalarType: ScalarType.STRING },
      ]);

      captureValues("example.Customer", { id: "cust-123" }, messageType);

      expect(getScalarMemorizedValue("id", ScalarType.STRING)).toBe("cust-123");

      clearTypeMemory();

      expect(getScalarMemorizedValue("id", ScalarType.STRING)).toBeUndefined();
      expect(getTypeMemorizedValue("example.Customer", "id")).toBeUndefined();
    });
  });

  describe("undefined lookups", () => {
    it("returns undefined for non-existent type", () => {
      expect(getTypeMemorizedValue("nonExistent.Type", "id")).toBeUndefined();
    });

    it("returns undefined for non-existent field in type", () => {
      captureValues("example.Customer", { id: "cust-123" });
      expect(getTypeMemorizedValue("example.Customer", "nonExistent")).toBeUndefined();
    });

    it("returns undefined for non-existent scalar field", () => {
      expect(getScalarMemorizedValue("nonExistent", ScalarType.STRING)).toBeUndefined();
    });
  });
});

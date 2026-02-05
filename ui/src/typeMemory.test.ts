import { describe, it, expect, beforeEach } from "vitest";
import { IMessageType, ScalarType } from "@protobuf-ts/runtime";
import {
  captureValues,
  getMessageMemorizedValue,
  getScalarMemorizedValue,
  getScalarMemorizedValues,
  clearTypeMemory,
  getAllStoredMessages,
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

      captureValues(
        "example.Customer",
        {
          id: "cust-123",
          name: "Acme Corp",
          count: 42,
          active: true,
        },
        messageType,
      );

      // Check scalar memory (field name + protobuf type)
      expect(getScalarMemorizedValue("id", ScalarType.STRING)).toBe("cust-123");
      expect(getScalarMemorizedValue("name", ScalarType.STRING)).toBe("Acme Corp");
      expect(getScalarMemorizedValue("count", ScalarType.INT32)).toBe(42);
      expect(getScalarMemorizedValue("active", ScalarType.BOOL)).toBe(true);

      // Check type memory (message type + field path)
      expect(getMessageMemorizedValue("example.Customer", "id")).toBe("cust-123");
      expect(getMessageMemorizedValue("example.Customer", "name")).toBe("Acme Corp");
    });

    it("returns most recently used value", () => {
      const messageType = mockMessageType("example.Customer", [{ name: "id", scalarType: ScalarType.STRING }]);

      captureValues("example.Customer", { id: "cust-1" }, messageType);
      captureValues("example.Customer", { id: "cust-2" }, messageType);
      captureValues("example.Customer", { id: "cust-3" }, messageType);

      // Most recent value should be returned
      expect(getScalarMemorizedValue("id", ScalarType.STRING)).toBe("cust-3");
      expect(getMessageMemorizedValue("example.Customer", "id")).toBe("cust-3");

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
      expect(getMessageMemorizedValue("example.Customer", "id")).toBe("cust-123");
      expect(getMessageMemorizedValue("example.Customer", "name")).toBe("Acme Corp");

      // Scalar memory should be empty (no schema = no protobuf type info)
      expect(getAllStoredScalars()).toHaveLength(0);
    });

    it("captures only top-level scalar fields (nested objects are different types)", () => {
      captureValues("example.Order", {
        orderId: "order-456",
        customer: {
          id: "cust-789",
          name: "Test Customer",
        },
        total: 99.99,
      });

      // Only top-level scalars are captured
      expect(getMessageMemorizedValue("example.Order", "orderId")).toBe("order-456");
      expect(getMessageMemorizedValue("example.Order", "total")).toBe(99.99);
      // Nested objects are not captured without schema (we don't know their type)
      expect(getMessageMemorizedValue("example.Order", "customer.id")).toBeUndefined();
    });

    it("ignores null/undefined values", () => {
      captureValues("example.Customer", null);
      captureValues("example.Customer", undefined);

      expect(getAllStoredMessages()).toHaveLength(0);
      expect(getAllStoredScalars()).toHaveLength(0);
    });

    it("ignores empty type names", () => {
      captureValues("", { id: "test" });

      expect(getAllStoredMessages()).toHaveLength(0);
      expect(getAllStoredScalars()).toHaveLength(0);
    });
  });

  describe("scalar memory with protobuf types", () => {
    it("shares scalar values across different message types with same field name", () => {
      const responseType = mockMessageType("example.GetCustomerResponse", [
        { name: "id", scalarType: ScalarType.STRING },
        { name: "name", scalarType: ScalarType.STRING },
      ]);

      captureValues(
        "example.GetCustomerResponse",
        {
          id: "cust-123",
          name: "Acme Corp",
        },
        responseType,
      );

      // The same "id" field name should be available for any STRING field named "id"
      expect(getScalarMemorizedValue("id", ScalarType.STRING)).toBe("cust-123");
      expect(getScalarMemorizedValue("name", ScalarType.STRING)).toBe("Acme Corp");
    });

    it("separates same field name with different protobuf types", () => {
      const typeA = mockMessageType("example.TypeA", [{ name: "count", scalarType: ScalarType.INT32 }]);
      const typeB = mockMessageType("example.TypeB", [{ name: "count", scalarType: ScalarType.INT64 }]);

      captureValues("example.TypeA", { count: 42 }, typeA);
      captureValues("example.TypeB", { count: "100" }, typeB);

      // Different protobuf scalar types are stored separately
      expect(getScalarMemorizedValue("count", ScalarType.INT32)).toBe(42);
      expect(getScalarMemorizedValue("count", ScalarType.INT64)).toBe("100");
    });
  });

  describe("getScalarMemorizedValues", () => {
    it("returns memorized values for a field", () => {
      const messageType = mockMessageType("example.Customer", [{ name: "id", scalarType: ScalarType.STRING }]);

      captureValues("example.Customer", { id: "cust-1" }, messageType);

      const values = getScalarMemorizedValues("id", ScalarType.STRING);
      expect(values).toHaveLength(1);
      expect(values).toContain("cust-1");
    });

    it("returns empty array for non-existent field", () => {
      const values = getScalarMemorizedValues("nonExistent", ScalarType.STRING);
      expect(values).toEqual([]);
    });
  });

  describe("clearTypeMemory", () => {
    it("clears all memory", () => {
      const messageType = mockMessageType("example.Customer", [{ name: "id", scalarType: ScalarType.STRING }]);

      captureValues("example.Customer", { id: "cust-123" }, messageType);

      expect(getScalarMemorizedValue("id", ScalarType.STRING)).toBe("cust-123");

      clearTypeMemory();

      expect(getScalarMemorizedValue("id", ScalarType.STRING)).toBeUndefined();
      expect(getMessageMemorizedValue("example.Customer", "id")).toBeUndefined();
    });
  });

  describe("key eviction", () => {
    it("evicts oldest keys when exceeding 2x max", () => {
      // Each message creates 2 keys (1 message + 1 scalar)
      // Max is 100, eviction triggers at >200
      // Create 102 types = 204 keys without eviction
      for (let i = 0; i < 102; i++) {
        const msgType = mockMessageType(`example.Type${i}`, [{ name: `field${i}`, scalarType: ScalarType.STRING }]);
        captureValues(`example.Type${i}`, { [`field${i}`]: `value${i}` }, msgType);
      }

      // After eviction, should be around 100 keys (not 204)
      const allKeys = [...getAllStoredMessages(), ...getAllStoredScalars()];
      expect(allKeys.length).toBeLessThanOrEqual(105);
      expect(allKeys.length).toBeGreaterThan(50);

      // Most recent keys should still exist
      expect(getMessageMemorizedValue("example.Type101", "field101")).toBe("value101");
    });
  });

  describe("undefined lookups", () => {
    it("returns undefined for non-existent type", () => {
      expect(getMessageMemorizedValue("nonExistent.Type", "id")).toBeUndefined();
    });

    it("returns undefined for non-existent field in type", () => {
      captureValues("example.Customer", { id: "cust-123" });
      expect(getMessageMemorizedValue("example.Customer", "nonExistent")).toBeUndefined();
    });

    it("returns undefined for non-existent scalar field", () => {
      expect(getScalarMemorizedValue("nonExistent", ScalarType.STRING)).toBeUndefined();
    });
  });
});

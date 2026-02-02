import { describe, it, expect, beforeEach } from "vitest";
import {
  captureValues,
  getTypeMemorizedValue,
  getScalarMemorizedValue,
  getScalarMemorizedValues,
  clearTypeMemory,
  getAllStoredTypes,
  getAllStoredScalars,
} from "./typeMemory";

describe("typeMemory", () => {
  beforeEach(() => {
    clearTypeMemory();
  });

  describe("captureValues", () => {
    it("captures scalar values by type and field name", () => {
      captureValues("example.Customer", {
        id: "cust-123",
        name: "Acme Corp",
        count: 42,
        active: true,
      });

      // Check scalar memory (field name + type)
      expect(getScalarMemorizedValue("id", "string")).toBe("cust-123");
      expect(getScalarMemorizedValue("name", "string")).toBe("Acme Corp");
      expect(getScalarMemorizedValue("count", "number")).toBe(42);
      expect(getScalarMemorizedValue("active", "boolean")).toBe(true);

      // Check type memory (message type + field path)
      expect(getTypeMemorizedValue("example.Customer", "id")).toBe("cust-123");
      expect(getTypeMemorizedValue("example.Customer", "name")).toBe("Acme Corp");
    });

    it("captures nested object values", () => {
      captureValues("example.Order", {
        orderId: "order-456",
        customer: {
          id: "cust-789",
          name: "Test Customer",
        },
        total: 99.99,
      });

      // Scalar memory for nested fields
      expect(getScalarMemorizedValue("orderId", "string")).toBe("order-456");
      expect(getScalarMemorizedValue("id", "string")).toBe("cust-789");
      expect(getScalarMemorizedValue("name", "string")).toBe("Test Customer");
      expect(getScalarMemorizedValue("total", "number")).toBe(99.99);

      // Type memory with paths
      expect(getTypeMemorizedValue("example.Order", "orderId")).toBe("order-456");
      expect(getTypeMemorizedValue("example.Order", "customer.id")).toBe("cust-789");
      expect(getTypeMemorizedValue("example.Order", "customer.name")).toBe("Test Customer");
    });

    it("captures array values", () => {
      captureValues("example.UserList", {
        users: [
          { id: "user-1", name: "Alice" },
          { id: "user-2", name: "Bob" },
        ],
      });

      // Scalar memory returns most recent (last in array)
      expect(getScalarMemorizedValue("id", "string")).toBe("user-2");
      expect(getScalarMemorizedValue("name", "string")).toBe("Bob");

      // Type memory with array paths
      expect(getTypeMemorizedValue("example.UserList", "users[0].id")).toBe("user-1");
      expect(getTypeMemorizedValue("example.UserList", "users[0].name")).toBe("Alice");
      expect(getTypeMemorizedValue("example.UserList", "users[1].id")).toBe("user-2");
    });

    it("returns most recently used value", () => {
      captureValues("example.Customer", { id: "cust-1" });
      captureValues("example.Customer", { id: "cust-2" });
      captureValues("example.Customer", { id: "cust-3" });

      // Most recent value should be returned
      expect(getScalarMemorizedValue("id", "string")).toBe("cust-3");
      expect(getTypeMemorizedValue("example.Customer", "id")).toBe("cust-3");

      // Using an old value again makes it most recent
      captureValues("example.Customer", { id: "cust-1" });
      expect(getScalarMemorizedValue("id", "string")).toBe("cust-1");
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

  describe("scalar memory cross-type matching", () => {
    it("shares scalar values across different message types", () => {
      // Capture from GetCustomerResponse
      captureValues("example.GetCustomerResponse", {
        customer: {
          id: "cust-123",
          name: "Acme Corp",
        },
      });

      // The same "id" field name should be available for UpdateCustomerRequest
      expect(getScalarMemorizedValue("id", "string")).toBe("cust-123");
      expect(getScalarMemorizedValue("name", "string")).toBe("Acme Corp");
    });

    it("handles same field name with different types separately", () => {
      captureValues("example.TypeA", { count: 42 });
      captureValues("example.TypeB", { count: "forty-two" });

      // Different scalar types are stored separately
      expect(getScalarMemorizedValue("count", "number")).toBe(42);
      expect(getScalarMemorizedValue("count", "string")).toBe("forty-two");
    });
  });

  describe("getScalarMemorizedValues", () => {
    it("returns all memorized values for a field", () => {
      captureValues("example.Customer", { id: "cust-1" });
      captureValues("example.Customer", { id: "cust-2" });
      captureValues("example.Customer", { id: "cust-3" });

      const values = getScalarMemorizedValues("id", "string");
      expect(values).toHaveLength(3);
      expect(values.map((v) => v.value)).toContain("cust-1");
      expect(values.map((v) => v.value)).toContain("cust-2");
      expect(values.map((v) => v.value)).toContain("cust-3");
    });

    it("returns empty array for non-existent field", () => {
      const values = getScalarMemorizedValues("nonExistent", "string");
      expect(values).toEqual([]);
    });
  });

  describe("clearTypeMemory", () => {
    it("clears all memory", () => {
      captureValues("example.Customer", { id: "cust-123" });

      expect(getScalarMemorizedValue("id", "string")).toBe("cust-123");

      clearTypeMemory();

      expect(getScalarMemorizedValue("id", "string")).toBeUndefined();
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
      expect(getScalarMemorizedValue("nonExistent", "string")).toBeUndefined();
    });
  });
});

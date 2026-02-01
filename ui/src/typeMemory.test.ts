import { describe, it, expect, beforeEach } from "vitest";
import {
  getTypeMemory,
  setTypeMemory,
  captureMethodInput,
  getMemorizedValue,
  createMethodKey,
  clearTypeMemory,
  captureResponseType,
  getTypeMemorizedValue,
  getTypeBasedMemory,
} from "./typeMemory";

describe("typeMemory", () => {
  beforeEach(() => {
    clearTypeMemory();
  });

  it("creates method key correctly", () => {
    expect(createMethodKey("myProject", "UserService", "GetUser")).toBe("myProject:UserService:GetUser");
  });

  it("captures and retrieves simple values", () => {
    const methodKey = createMethodKey("myProject", "UserService", "GetUser");

    captureMethodInput("myProject", "UserService", "GetUser", {
      id: "user-123",
      name: "John",
    });

    expect(getMemorizedValue(methodKey, "id")).toBe("user-123");
    expect(getMemorizedValue(methodKey, "name")).toBe("John");
  });

  it("captures nested object values", () => {
    const methodKey = createMethodKey("myProject", "UserService", "CreateUser");

    captureMethodInput("myProject", "UserService", "CreateUser", {
      user: {
        name: "Jane",
        email: "jane@example.com",
      },
    });

    expect(getMemorizedValue(methodKey, "user.name")).toBe("Jane");
    expect(getMemorizedValue(methodKey, "user.email")).toBe("jane@example.com");
  });

  it("captures array values", () => {
    const methodKey = createMethodKey("myProject", "UserService", "BatchCreate");

    captureMethodInput("myProject", "UserService", "BatchCreate", {
      ids: ["id-1", "id-2", "id-3"],
    });

    expect(getMemorizedValue(methodKey, "ids[0]")).toBe("id-1");
    expect(getMemorizedValue(methodKey, "ids[1]")).toBe("id-2");
    expect(getMemorizedValue(methodKey, "ids[2]")).toBe("id-3");
  });

  it("returns most frequently used value", () => {
    const methodKey = createMethodKey("myProject", "UserService", "GetUser");

    captureMethodInput("myProject", "UserService", "GetUser", { id: "user-1" });
    captureMethodInput("myProject", "UserService", "GetUser", { id: "user-2" });
    captureMethodInput("myProject", "UserService", "GetUser", { id: "user-2" });
    captureMethodInput("myProject", "UserService", "GetUser", { id: "user-2" });

    expect(getMemorizedValue(methodKey, "id")).toBe("user-2");
  });

  it("handles boolean values", () => {
    const methodKey = createMethodKey("myProject", "UserService", "UpdateUser");

    captureMethodInput("myProject", "UserService", "UpdateUser", {
      active: true,
    });

    expect(getMemorizedValue(methodKey, "active")).toBe(true);
  });

  it("handles numeric values", () => {
    const methodKey = createMethodKey("myProject", "UserService", "SetLimit");

    captureMethodInput("myProject", "UserService", "SetLimit", {
      limit: 100,
      offset: 0,
    });

    expect(getMemorizedValue(methodKey, "limit")).toBe(100);
    expect(getMemorizedValue(methodKey, "offset")).toBe(0);
  });

  it("returns undefined for non-existent paths", () => {
    const methodKey = createMethodKey("myProject", "UserService", "GetUser");

    captureMethodInput("myProject", "UserService", "GetUser", { id: "user-1" });

    expect(getMemorizedValue(methodKey, "nonExistent")).toBeUndefined();
  });

  it("returns undefined for non-existent methods", () => {
    expect(getMemorizedValue("nonExistent:Method:Key", "id")).toBeUndefined();
  });

  it("clears type memory", () => {
    captureMethodInput("myProject", "UserService", "GetUser", { id: "user-1" });
    const methodKey = createMethodKey("myProject", "UserService", "GetUser");

    expect(getMemorizedValue(methodKey, "id")).toBe("user-1");

    clearTypeMemory();

    expect(getMemorizedValue(methodKey, "id")).toBeUndefined();
  });
});

describe("type-based memory", () => {
  beforeEach(() => {
    clearTypeMemory();
  });

  it("captures response type values", () => {
    captureResponseType("example.Customer", {
      id: "cust-123",
      name: "Acme Corp",
      email: "contact@acme.com",
    });

    expect(getTypeMemorizedValue("example.Customer", "id")).toBe("cust-123");
    expect(getTypeMemorizedValue("example.Customer", "name")).toBe("Acme Corp");
    expect(getTypeMemorizedValue("example.Customer", "email")).toBe("contact@acme.com");
  });

  it("captures nested response values", () => {
    captureResponseType("example.Order", {
      orderId: "order-456",
      customer: {
        id: "cust-789",
        name: "Test Customer",
      },
      total: 99.99,
    });

    expect(getTypeMemorizedValue("example.Order", "orderId")).toBe("order-456");
    expect(getTypeMemorizedValue("example.Order", "customer.id")).toBe("cust-789");
    expect(getTypeMemorizedValue("example.Order", "customer.name")).toBe("Test Customer");
    expect(getTypeMemorizedValue("example.Order", "total")).toBe(99.99);
  });

  it("captures array values in response", () => {
    captureResponseType("example.UserList", {
      users: [
        { id: "user-1", name: "Alice" },
        { id: "user-2", name: "Bob" },
      ],
    });

    expect(getTypeMemorizedValue("example.UserList", "users[0].id")).toBe("user-1");
    expect(getTypeMemorizedValue("example.UserList", "users[0].name")).toBe("Alice");
    expect(getTypeMemorizedValue("example.UserList", "users[1].id")).toBe("user-2");
  });

  it("returns most frequently used response value", () => {
    captureResponseType("example.Customer", { id: "cust-1" });
    captureResponseType("example.Customer", { id: "cust-2" });
    captureResponseType("example.Customer", { id: "cust-2" });
    captureResponseType("example.Customer", { id: "cust-2" });

    expect(getTypeMemorizedValue("example.Customer", "id")).toBe("cust-2");
  });

  it("returns undefined for non-existent type", () => {
    expect(getTypeMemorizedValue("nonExistent.Type", "id")).toBeUndefined();
  });

  it("returns undefined for non-existent field in type", () => {
    captureResponseType("example.Customer", { id: "cust-123" });

    expect(getTypeMemorizedValue("example.Customer", "nonExistent")).toBeUndefined();
  });

  it("ignores null/undefined responses", () => {
    captureResponseType("example.Customer", null);
    captureResponseType("example.Customer", undefined);

    expect(getTypeBasedMemory("example.Customer")).toBeUndefined();
  });

  it("ignores empty type names", () => {
    captureResponseType("", { id: "test" });

    const memory = getTypeMemory();
    expect(Object.keys(memory.types)).toHaveLength(0);
  });

  it("clears type-based memory with clearTypeMemory", () => {
    captureResponseType("example.Customer", { id: "cust-123" });

    expect(getTypeMemorizedValue("example.Customer", "id")).toBe("cust-123");

    clearTypeMemory();

    expect(getTypeMemorizedValue("example.Customer", "id")).toBeUndefined();
  });
});

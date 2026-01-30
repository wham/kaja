import { describe, it, expect, beforeEach } from "vitest";
import {
  getTypeMemory,
  setTypeMemory,
  captureMethodInput,
  getMemorizedValue,
  createMethodKey,
  clearTypeMemory,
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

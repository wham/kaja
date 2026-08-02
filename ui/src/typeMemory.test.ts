import { describe, it, expect, beforeEach } from "bun:test";
import { IMessageType, ScalarType } from "@protobuf-ts/runtime";
import { rememberValues, recallValues, clearTypeMemory, getAllRememberedFields, ValueSource } from "./typeMemory";

// Helper to create a minimal mock message type for testing
function mockMessageType(typeName: string, fields: any[]): IMessageType<any> {
  return {
    typeName,
    fields: fields.map((field, index) => ({ no: index + 1, localName: field.name, ...field })),
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

function scalars(typeName: string, fields: { name: string; scalarType: ScalarType }[]): IMessageType<any> {
  return mockMessageType(
    typeName,
    fields.map((field) => ({ name: field.name, kind: "scalar", T: field.scalarType })),
  );
}

const request: ValueSource = { method: "ExampleService.GetCustomer", origin: "request" };
const response: ValueSource = { method: "ExampleService.ListCustomers", origin: "response" };

describe("typeMemory", () => {
  beforeEach(() => {
    clearTypeMemory();
  });

  describe("rememberValues", () => {
    it("remembers scalar values with where they came from", () => {
      const customer = scalars("example.Customer", [
        { name: "id", scalarType: ScalarType.STRING },
        { name: "count", scalarType: ScalarType.INT32 },
        { name: "active", scalarType: ScalarType.BOOL },
      ]);

      rememberValues("example.Customer", { id: "cust-123", count: 42, active: true }, customer, response);

      const [id] = recallValues("example.Customer", "id", ScalarType.STRING);
      expect(id.value).toBe("cust-123");
      expect(id.typeName).toBe("example.Customer");
      expect(id.origin).toBe("response");
      expect(id.method).toBe("ExampleService.ListCustomers");

      expect(recallValues("example.Customer", "count", ScalarType.INT32)[0].value).toBe(42);
      expect(recallValues("example.Customer", "active", ScalarType.BOOL)[0].value).toBe(true);
    });

    it("keeps several values per field, most recent first", () => {
      const customer = scalars("example.Customer", [{ name: "id", scalarType: ScalarType.STRING }]);

      rememberValues("example.Customer", { id: "cust-1" }, customer, request);
      rememberValues("example.Customer", { id: "cust-2" }, customer, request);
      rememberValues("example.Customer", { id: "cust-3" }, customer, request);

      expect(recallValues("example.Customer", "id", ScalarType.STRING).map((value) => value.value)).toEqual(["cust-3", "cust-2", "cust-1"]);

      // Re-using an older value moves it back to the front rather than duplicating it.
      rememberValues("example.Customer", { id: "cust-1" }, customer, request);
      expect(recallValues("example.Customer", "id", ScalarType.STRING).map((value) => value.value)).toEqual(["cust-1", "cust-3", "cust-2"]);
    });

    it("keeps at most five values per field", () => {
      const customer = scalars("example.Customer", [{ name: "id", scalarType: ScalarType.STRING }]);

      for (let index = 0; index < 8; index++) {
        rememberValues("example.Customer", { id: `cust-${index}` }, customer, request);
      }

      expect(recallValues("example.Customer", "id", ScalarType.STRING)).toHaveLength(5);
    });

    it("remembers nested messages under their own type", () => {
      const address = scalars("example.Address", [{ name: "city", scalarType: ScalarType.STRING }]);
      const customer = mockMessageType("example.Customer", [
        { name: "id", kind: "scalar", T: ScalarType.STRING },
        { name: "address", kind: "message", T: () => address },
      ]);

      rememberValues("example.Customer", { id: "cust-1", address: { city: "Berlin" } }, customer, response);

      expect(recallValues("example.Address", "city", ScalarType.STRING)[0].value).toBe("Berlin");
      expect(getAllRememberedFields()).toContain("example.Address:city");
      expect(getAllRememberedFields()).not.toContain("example.Customer:city");
    });

    it("remembers the elements of repeated fields", () => {
      const customer = scalars("example.Customer", [{ name: "id", scalarType: ScalarType.STRING }]);
      const list = mockMessageType("example.CustomerList", [{ name: "customers", kind: "message", repeat: 2, T: () => customer }]);

      rememberValues("example.CustomerList", { customers: [{ id: "cust-1" }, { id: "cust-2" }] }, list, response);

      expect(recallValues("example.Customer", "id", ScalarType.STRING).map((value) => value.value)).toEqual(["cust-2", "cust-1"]);
    });

    it("ignores null, undefined and empty type names", () => {
      rememberValues("example.Customer", null, undefined, request);
      rememberValues("example.Customer", undefined, undefined, request);
      rememberValues("", { id: "test" }, undefined, request);

      expect(getAllRememberedFields()).toHaveLength(0);
    });

    it("remembers top-level scalars when there is no schema", () => {
      rememberValues("example.Order", { orderId: "order-456", customer: { id: "cust-789" }, total: 99.99 }, undefined, response);

      expect(recallValues("example.Order", "orderId")[0].value).toBe("order-456");
      expect(recallValues("example.Order", "total")[0].value).toBe(99.99);
      // Without a schema there is no way to know the nested object's type.
      expect(getAllRememberedFields()).not.toContain("example.Customer:id");
    });
  });

  describe("recallValues", () => {
    it("offers values from a same-named field of another type, after the exact ones", () => {
      const customer = scalars("example.Customer", [{ name: "id", scalarType: ScalarType.STRING }]);
      const getRequest = scalars("example.GetCustomerRequest", [{ name: "id", scalarType: ScalarType.STRING }]);

      rememberValues("example.Customer", { id: "from-response" }, customer, response);
      rememberValues("example.GetCustomerRequest", { id: "from-request" }, getRequest, request);

      const values = recallValues("example.GetCustomerRequest", "id", ScalarType.STRING);
      expect(values.map((value) => value.value)).toEqual(["from-request", "from-response"]);
      expect(values[1].typeName).toBe("example.Customer");
    });

    it("does not mix up same-named fields of different scalar types", () => {
      const typeA = scalars("example.TypeA", [{ name: "count", scalarType: ScalarType.INT32 }]);
      const typeB = scalars("example.TypeB", [{ name: "count", scalarType: ScalarType.INT64 }]);

      rememberValues("example.TypeA", { count: 42 }, typeA, request);
      rememberValues("example.TypeB", { count: "100" }, typeB, request);

      expect(recallValues("example.TypeC", "count", ScalarType.INT32).map((value) => value.value)).toEqual([42]);
      expect(recallValues("example.TypeC", "count", ScalarType.INT64).map((value) => value.value)).toEqual(["100"]);
    });

    it("offers nothing across types without a scalar type to match on", () => {
      const customer = scalars("example.Customer", [{ name: "id", scalarType: ScalarType.STRING }]);
      rememberValues("example.Customer", { id: "cust-1" }, customer, response);

      expect(recallValues("example.GetCustomerRequest", "id")).toHaveLength(0);
    });

    it("returns nothing for a field that was never seen", () => {
      expect(recallValues("example.Customer", "nonExistent", ScalarType.STRING)).toEqual([]);
    });
  });

  describe("clearTypeMemory", () => {
    it("forgets everything", () => {
      const customer = scalars("example.Customer", [{ name: "id", scalarType: ScalarType.STRING }]);
      rememberValues("example.Customer", { id: "cust-123" }, customer, request);

      clearTypeMemory();

      expect(recallValues("example.Customer", "id", ScalarType.STRING)).toEqual([]);
      expect(getAllRememberedFields()).toHaveLength(0);
    });
  });

  describe("key eviction", () => {
    it("evicts the oldest keys when the store grows past its limit", () => {
      // Each captured field creates two keys (the field and its by-name index),
      // so 500 fields is well past the 400-key limit and its 2x eviction point.
      for (let index = 0; index < 500; index++) {
        const messageType = scalars(`example.Type${index}`, [{ name: `field${index}`, scalarType: ScalarType.STRING }]);
        rememberValues(`example.Type${index}`, { [`field${index}`]: `value${index}` }, messageType, request);
      }

      expect(getAllRememberedFields().length).toBeLessThan(500);
      // The most recent ones survive.
      expect(recallValues("example.Type499", "field499", ScalarType.STRING)[0].value).toBe("value499");
    });
  });
});

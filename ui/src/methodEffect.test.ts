import { describe, expect, it } from "bun:test";
import { Method, Service } from "./apps";
import { isRefusal, methodEffect, readingName, refuseWrite } from "./methodEffect";

const service: Service = { name: "Shows", packageName: "theatre", sourcePath: "theatre/service", clientStubModuleId: "stub", methods: [] };

function method(name: string, http?: string): Method {
  return { name, http };
}

describe("readingName", () => {
  it("reads a prefix only where the name breaks", () => {
    expect(readingName("GetShow")).toBe(true);
    expect(readingName("ListShows")).toBe(true);
    expect(readingName("SearchShows")).toBe(true);
    expect(readingName("Get")).toBe(true);
    // The prefix runs into the rest of the word, so it isn't the verb.
    expect(readingName("Generate")).toBe(false);
    expect(readingName("Islands")).toBe(false);
    expect(readingName("IngestEvents")).toBe(false);
    expect(readingName("Delete")).toBe(false);
  });
});

describe("methodEffect", () => {
  it("lets an HTTP verb settle it", () => {
    expect(methodEffect(method("ListShows", "GET /shows"))).toEqual({ read: true, certain: true });
    expect(methodEffect(method("CreateShow", "POST /shows"))).toEqual({ read: false, certain: true });
    // The verb outranks the name: a method called Get that POSTs writes.
    expect(methodEffect(method("GetReport", "POST /reports/search"))).toEqual({ read: false, certain: true });
  });

  it("falls back to the name, and says it is a guess", () => {
    expect(methodEffect(method("GetSeatMap"))).toEqual({ read: true, certain: false });
    expect(methodEffect(method("Annotate"))).toEqual({ read: false, certain: false });
    // Not a request line, so there is no verb in it to read.
    expect(methodEffect(method("Annotate", "GET"))).toEqual({ read: false, certain: false });
  });
});

describe("refuseWrite", () => {
  it("lets a read through", () => {
    expect(refuseWrite("theatre", service, method("ListShows", "GET /shows"))).toBeUndefined();
  });

  it("names the method and the way forward", () => {
    const refusal = refuseWrite("theatre", service, method("CreateShow", "POST /shows"));
    expect(refusal?.message).toContain("theatre/Shows.CreateShow writes");
    expect(refusal?.message).toContain("create_script");
    expect(isRefusal(refusal)).toBe(true);
  });

  it("admits when the effect was inferred", () => {
    expect(refuseWrite("seating", service, method("Annotate"))?.message).toContain("inferred from its name");
    expect(refuseWrite("theatre", service, method("CreateShow", "POST /shows"))?.message).not.toContain("inferred");
  });

  it("does not mistake an ordinary failure for a refusal", () => {
    expect(isRefusal(new Error("connection reset"))).toBe(false);
    expect(isRefusal(undefined)).toBe(false);
  });
});

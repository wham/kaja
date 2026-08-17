import { describe, expect, it } from "bun:test";
import { App, Method, Service } from "./apps";
import { countHits, filterApps } from "./appFilter";

function service(name: string, methods: string[]): Service {
  return {
    name,
    packageName: "demo",
    sourcePath: `${name}.proto`,
    clientStubModuleId: `${name}.client`,
    methods: methods.map((method) => ({ name: method }) as Method),
  };
}

function app(name: string, services: Service[]): App {
  return { configuration: { name }, services } as unknown as App;
}

const apps = [
  app("theatre", [service("Theatre", ["ListMovies", "ListShows", "CreateShow"])]),
  app("seating", [service("Seating", ["GetSeatMap", "BookSeats"])]),
];

describe("filterApps", () => {
  it("matches a method by its own name", () => {
    const hits = filterApps(apps, "seatmap");
    expect(hits.length).toBe(1);
    expect(hits[0]!.app.configuration.name).toBe("seating");
    expect(hits[0]!.methods.map((hit) => hit.method.name)).toEqual(["GetSeatMap"]);
  });

  it("matches on Service.Method, which is how a method is written down", () => {
    const hits = filterApps(apps, "theatre.list");
    expect(hits[0]!.methods.map((hit) => hit.method.name)).toEqual(["ListMovies", "ListShows"]);
  });

  it("takes a whole service when the service is what matched", () => {
    expect(countHits(filterApps(apps, "seating"))).toBe(2);
  });

  it("takes a whole app when the app is what matched", () => {
    const hits = filterApps(apps, "theatre");
    expect(hits.length).toBe(1);
    expect(hits[0]!.methods.length).toBe(3);
  });

  it("is case-insensitive and ignores surrounding space", () => {
    expect(countHits(filterApps(apps, "  BOOKSEATS "))).toBe(1);
  });

  it("drops an app nothing in it matched", () => {
    expect(filterApps(apps, "movies").map((hit) => hit.app.configuration.name)).toEqual(["theatre"]);
  });

  it("has nothing to say about an empty query — the tree is the answer then", () => {
    expect(filterApps(apps, "")).toEqual([]);
    expect(filterApps(apps, "   ")).toEqual([]);
  });

  it("counts every hit, across apps", () => {
    expect(countHits(filterApps(apps, "list"))).toBe(2);
    expect(countHits(filterApps(apps, "s"))).toBe(5);
  });
});

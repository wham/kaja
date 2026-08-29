import { App, Client, Methods, serviceId } from "./apps";
import { restOperations } from "./httpMethod";
import { Call, CallOptions, Kaja } from "./kaja";
import { APP_OF } from "./rateLimit";

// The name the REST door is exported and imported under. Fixed rather than the app's
// own name, which may be no identifier at all (`grpcb.in`, a name with a space) and
// which two apps in one script would collide on — the generated code aliases it back
// to the app (`import { api as theatre }`), so what is read is still the app's name.
export const REST_DOOR = "api";

// What the door is called in a script. The export is always `api`, so the generated
// code aliases it to the app — `import { api as theatre }` — which is what makes two
// REST apps in one script readable and keeps the app's own name in front of the call.
// An app whose name is no identifier keeps the plain `api`.
export function doorBinding(appName: string): string {
  return appName !== REST_DOOR && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(appName) ? appName : REST_DOOR;
}

// A method addressed the way its own API addresses it. The verbs are the members
// httpMethod's VERBS lists; a path that is not one of the app's is a type error before
// it is a lookup that fails.
export interface RestDoor {
  [verb: string]: (path: string, request?: unknown, options?: CallOptions) => Call<unknown>;
}

// The door is a second address for the methods that already exist, not a second way of
// calling them: it hands the call to the same bound `Methods`, so the log row, the
// approvals, the rate limiter, the console and the run's stats cannot tell which door
// the call came through — and a script may use both in one file.
//
// Bound per run for the same reason `Client.methodsFor` is: the methods it routes to
// belong to one run, and two scripts running at once must not reach into each other's.
const doors = new WeakMap<App, WeakMap<Kaja, RestDoor>>();

export function restDoorFor(app: App, kaja: Kaja): RestDoor {
  let perRun = doors.get(app);
  if (!perRun) {
    perRun = new WeakMap();
    doors.set(app, perRun);
  }
  const existing = perRun.get(kaja);
  if (existing) return existing;

  const door = buildDoor(app, kaja);
  perRun.set(kaja, door);
  return door;
}

function buildDoor(app: App, kaja: Kaja): RestDoor {
  // Resolved once per run: which service's methods answer a given verb and path.
  const routes = new Map<string, { client: Client; methodName: string }>();
  for (const { service, method, request } of restOperations(app.services)) {
    const client = app.clients[serviceId(service)];
    if (client) routes.set(routeKey(request.verb, request.path), { client, methodName: method.name });
  }

  const door: RestDoor = {};
  Object.defineProperty(door, APP_OF, { get: () => app.configuration.name });

  // Bound methods are asked for per call rather than up front, so the door costs a run
  // that never uses it nothing, and memoization inside methodsFor keeps it to one
  // lookup per service.
  const verbs = new Set([...routes.keys()].map((key) => key.slice(0, key.indexOf(" ")).toLowerCase()));
  for (const verb of verbs) {
    door[verb] = (path: string, request?: unknown, options?: CallOptions) => {
      const route = routes.get(routeKey(verb, path));
      if (!route) {
        throw new Error(`App "${app.configuration.name}" has no ${verb.toUpperCase()} ${path}.`);
      }
      const methods: Methods = route.client.methodsFor(kaja);
      return methods[route.methodName](request ?? {}, options);
    };
  }
  return door;
}

function routeKey(verb: string, path: string): string {
  return `${verb.toUpperCase()} ${path}`;
}

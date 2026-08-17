import { App, Method, Service } from "./apps";

/**
 * The catalog half of the sidebar's search.
 *
 * The search is the panel's rather than either section's, so it has to answer
 * for the app tree as well as for the scripts — and a dense tree of forty
 * methods is the list it was worth building for. The rule is the one the scripts
 * filter already follows: match, then **flatten**. A tree with one match per
 * branch is a worse answer than a list, so a hit is a method row under its app,
 * carrying the service it came from as a dim suffix.
 *
 * A needle matches a method by its own name, by `Service.Method`, by the
 * service's name, or by the app's — matching a container means everything in it,
 * because "show me what is in OpenMeter" is a question people ask of a tree.
 */

export interface MethodHit {
  service: Service;
  method: Method;
}

export interface AppHits {
  app: App;
  methods: MethodHit[];
}

export function filterApps(apps: App[], query: string): AppHits[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const hits: AppHits[] = [];
  for (const app of apps) {
    const wholeApp = app.configuration.name.toLowerCase().includes(needle);
    const methods: MethodHit[] = [];
    for (const service of app.services) {
      const wholeService = wholeApp || service.name.toLowerCase().includes(needle);
      for (const method of service.methods) {
        if (wholeService || `${service.name}.${method.name}`.toLowerCase().includes(needle)) {
          methods.push({ service, method });
        }
      }
    }
    if (methods.length > 0) hits.push({ app, methods });
  }
  return hits;
}

export function countHits(hits: AppHits[]): number {
  return hits.reduce((total, hit) => total + hit.methods.length, 0);
}

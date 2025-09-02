import { Kaja } from "./kaja";
import { Sources } from "./sources";
import { ConfigurationProject } from "./server/api";
export interface Project {
  configuration: ConfigurationProject;
  services: Service[];
  clients: Clients;
  sources: Sources;
}

export interface Service {
  name: string;
  methods: Array<Method>;
}

export interface Method {
  name: string;
  editorCode: string;
}

export interface Clients {
  [key: string]: Client;
}

export interface Client {
  kaja?: Kaja;
  methods: { [key: string]: (input: any) => {} };
}

export function methodId(service: Service, method: Method): string {
  return `${service.name}.${method.name}`;
}

export function getDefaultMethod(services: Service[]): Method | undefined {
  for (const service of services) {
    for (const method of service.methods) {
      return method;
    }
  }
  return undefined;
}

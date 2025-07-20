export namespace compiler {
  export class Log {
    Level: number;
    Message: string;

    static createFrom(source: any = {}) {
      return new Log(source);
    }

    constructor(source: any = {}) {
      if ("string" === typeof source) source = JSON.parse(source);
      this.Level = source["Level"];
      this.Message = source["Message"];
    }
  }
}

export namespace main {
  export class CompileRequest {
    log_offset: number;
    force: boolean;
    project_name: string;
    workspace: string;

    static createFrom(source: any = {}) {
      return new CompileRequest(source);
    }

    constructor(source: any = {}) {
      if ("string" === typeof source) source = JSON.parse(source);
      this.log_offset = source["log_offset"];
      this.force = source["force"];
      this.project_name = source["project_name"];
      this.workspace = source["workspace"];
    }
  }
  export class CompileResponse {
    status: number;
    logs: compiler.Log[];
    sources: string[];

    static createFrom(source: any = {}) {
      return new CompileResponse(source);
    }

    constructor(source: any = {}) {
      if ("string" === typeof source) source = JSON.parse(source);
      this.status = source["status"];
      this.logs = this.convertValues(source["logs"], compiler.Log);
      this.sources = source["sources"];
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ("object" === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
  export class ConfigurationAI {
    base_url: string;
    api_key: string;

    static createFrom(source: any = {}) {
      return new ConfigurationAI(source);
    }

    constructor(source: any = {}) {
      if ("string" === typeof source) source = JSON.parse(source);
      this.base_url = source["base_url"];
      this.api_key = source["api_key"];
    }
  }
  export class ConfigurationProject {
    name: string;
    protocol: number;
    url: string;
    workspace: string;

    static createFrom(source: any = {}) {
      return new ConfigurationProject(source);
    }

    constructor(source: any = {}) {
      if ("string" === typeof source) source = JSON.parse(source);
      this.name = source["name"];
      this.protocol = source["protocol"];
      this.url = source["url"];
      this.workspace = source["workspace"];
    }
  }
  export class Configuration {
    path_prefix: string;
    projects: ConfigurationProject[];
    ai?: ConfigurationAI;

    static createFrom(source: any = {}) {
      return new Configuration(source);
    }

    constructor(source: any = {}) {
      if ("string" === typeof source) source = JSON.parse(source);
      this.path_prefix = source["path_prefix"];
      this.projects = this.convertValues(source["projects"], ConfigurationProject);
      this.ai = this.convertValues(source["ai"], ConfigurationAI);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ("object" === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }

  export class GetConfigurationRequest {
    static createFrom(source: any = {}) {
      return new GetConfigurationRequest(source);
    }

    constructor(source: any = {}) {
      if ("string" === typeof source) source = JSON.parse(source);
    }
  }
  export class GetConfigurationResponse {
    configuration?: Configuration;
    logs: compiler.Log[];

    static createFrom(source: any = {}) {
      return new GetConfigurationResponse(source);
    }

    constructor(source: any = {}) {
      if ("string" === typeof source) source = JSON.parse(source);
      this.configuration = this.convertValues(source["configuration"], Configuration);
      this.logs = this.convertValues(source["logs"], compiler.Log);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ("object" === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
}

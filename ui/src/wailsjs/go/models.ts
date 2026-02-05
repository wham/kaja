export namespace main {
  export class TargetResult {
    body: number[];
    statusCode: number;
    status: string;

    static createFrom(source: any = {}) {
      return new TargetResult(source);
    }

    constructor(source: any = {}) {
      if ("string" === typeof source) source = JSON.parse(source);
      this.body = source["body"];
      this.statusCode = source["statusCode"];
      this.status = source["status"];
    }
  }
}

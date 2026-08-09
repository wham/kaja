export namespace main {
	
	export class MCPInfo {
	    enabled: boolean;
	    url: string;
	    token: string;
	    error: string;
	    configurationPaths: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new MCPInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.url = source["url"];
	        this.token = source["token"];
	        this.error = source["error"];
	        this.configurationPaths = source["configurationPaths"];
	    }
	}
	export class ScriptFile {
	    path: string;
	    name: string;
	    content: string;
	
	    static createFrom(source: any = {}) {
	        return new ScriptFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.content = source["content"];
	    }
	}
	export class TargetResult {
	    body: number[];
	    statusCode: number;
	    status: string;
	    requestHeaders?: Record<string, string>;
	    responseHeaders?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new TargetResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.body = source["body"];
	        this.statusCode = source["statusCode"];
	        this.status = source["status"];
	        this.requestHeaders = source["requestHeaders"];
	        this.responseHeaders = source["responseHeaders"];
	    }
	}

}


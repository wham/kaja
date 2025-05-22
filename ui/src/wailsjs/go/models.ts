export namespace compiler {
	
	export class Log {
	    Level: number;
	    Message: string;
	
	    static createFrom(source: any = {}) {
	        return new Log(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Level = source["Level"];
	        this.Message = source["Message"];
	    }
	}

}


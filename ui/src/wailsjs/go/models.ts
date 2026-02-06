export namespace main {
	
	export class TargetResult {
	    body: number[];
	    statusCode: number;
	    status: string;
	
	    static createFrom(source: any = {}) {
	        return new TargetResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.body = source["body"];
	        this.statusCode = source["statusCode"];
	        this.status = source["status"];
	    }
	}
	export class UpdateInfo {
	    updateAvailable: boolean;
	    currentVersion: string;
	    latestVersion: string;
	    downloadUrl: string;
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.updateAvailable = source["updateAvailable"];
	        this.currentVersion = source["currentVersion"];
	        this.latestVersion = source["latestVersion"];
	        this.downloadUrl = source["downloadUrl"];
	        this.error = source["error"];
	    }
	}

}


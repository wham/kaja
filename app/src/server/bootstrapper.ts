import { exec } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { BootstrapRequest, BootstrapResponse, BootstrapStatus, Log, LogLevel } from "../shared/api";

export class Bootstrapper {
  status: BootstrapStatus;
  logs: Log[];

  constructor() {
    this.status = BootstrapStatus.STATUS_READY;
    this.logs = [];
  }

  async bootstrap(request: BootstrapRequest): Promise<BootstrapResponse> {
    if (this.status !== BootstrapStatus.STATUS_RUNNING && request.logOffset === 0) {
      this.status = BootstrapStatus.STATUS_RUNNING;
      this.logs = [];
      this.info("Bootstrap started");
      this.start();
    }

    return Promise.resolve({ status: this.status, logs: this.logs.slice(request.logOffset) });
  }

  private async start(): Promise<void> {
    this.debug("cwd: " + process.cwd());
    let workspaceDir = path.resolve(process.cwd(), "../workspace");
    if (!fs.existsSync(workspaceDir)) {
      workspaceDir = path.resolve(process.cwd(), "../demo");
    }
    const outputDir = path.resolve(process.cwd(), "../app/src/client/protoc");
    const tempDir = path.join(os.tmpdir(), "temp-protoc");
    this.debug("workspaceDir: " + workspaceDir);
    this.debug("outputDir: " + outputDir);
    this.debug("tempDir: " + tempDir);

    fs.mkdir(tempDir, { recursive: true }, (error) => {
      if (error) {
        this.error(`Failed to create directory ${tempDir}`, error);
      } else {
        this.debug(`Directory ${tempDir} created successfully or already exists`);
        const protocCommand = `npx protoc --ts_out ${tempDir} --ts_opt long_type_bigint -I${workspaceDir} $(find ${workspaceDir} -iname "*.proto")`;
        this.debug("Running protoc");
        this.debug(protocCommand);
        exec(protocCommand, (error, stdout) => {
          if (error) {
            this.error("Failed to run protoc", error);
            return;
          }

          this.info("Protoc completed successfully");
          if (fs.existsSync(outputDir)) {
            this.debug(`Directory ${outputDir} already exists, removing it`);
            fs.rmdirSync(outputDir, { recursive: true });
          }

          fs.renameSync(tempDir, outputDir);
          this.debug(`Protoc output moved from ${tempDir} to ${outputDir}`);
          this.info("Bootstrap completed successfully");
          this.status = BootstrapStatus.STATUS_READY;
        });
      }
    });
  }

  private debug(message: string) {
    this.log(message, LogLevel.LEVEL_DEBUG);
  }

  private info(message: string) {
    this.log(message, LogLevel.LEVEL_INFO);
  }

  private warn(message: string) {
    this.log(message, LogLevel.LEVEL_WARN);
  }

  private error(message: string, error?: Error) {
    this.status = BootstrapStatus.STATUS_ERROR;
    this.log(message, LogLevel.LEVEL_ERROR, error);
  }

  private log(message: string, level: LogLevel, error?: Error) {
    console.log(message, error);
    this.logs.push({ message, index: this.logs.length, level });
    if (error) {
      this.logs.push({ message: error.message, index: this.logs.length, level });
    }
  }
}

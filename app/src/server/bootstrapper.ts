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
    console.log("bootstrap()", this.status, request.logOffset);
    if (this.status !== BootstrapStatus.STATUS_RUNNING && request.logOffset === 0) {
      this.status = BootstrapStatus.STATUS_RUNNING;
      this.logs = [];
      this.info("Bootstrap started");
      this.start();
    }

    return Promise.resolve({ status: this.status, logs: this.logs.slice(request.logOffset) });
  }

  private async start(): Promise<void> {
    this.debug(process.cwd());
    let protoPath = path.resolve(process.cwd(), "../workspace");
    if (!fs.existsSync(protoPath)) {
      protoPath = path.resolve(process.cwd(), "../demo");
    }
    const outPath = path.resolve(process.cwd(), "../app/src/client/protoc");
    const tempDir = path.join(os.tmpdir(), "temp-protoc");
    this.debug("protoPath: " + protoPath);
    this.debug("outPath: " + outPath);
    this.debug("tempDir: " + tempDir);

    fs.mkdir(tempDir, { recursive: true }, (error) => {
      if (error) {
        this.error("Failed to create temp output directory", error);
      } else {
        this.debug("Temp output directory created or already exists");
        const protocCommand = `npx protoc --ts_out ${tempDir} --ts_opt long_type_bigint -I${protoPath} $(find ${protoPath} -iname "*.proto")`;
        this.debug(protocCommand);
        exec(protocCommand, (error, stdout, stderr) => {
          if (error) {
            this.error("Failed to run protoc", error);
            return;
          }

          this.debug(stdout);
          for (let line in stdout.split("\n")) {
            this.debug(line);
          }
          this.info("Protoc ran successfully");
          if (fs.existsSync(outPath)) {
            fs.rmdirSync(outPath, { recursive: true });
          }
          fs.renameSync(tempDir, outPath);
          this.debug("Protoc output moved to client/protoc");
          if (process.env.NODE_ENV === "production") {
            this.info("Building client");
            exec(`npm run build`, (error, stdout, stderr) => {
              if (error) {
                this.error("Failed to run npm build", error);
                return;
              }

              for (let line in stdout.split("\n")) {
                this.debug(line);
              }
              this.info("Client built successfully");
              this.status = BootstrapStatus.STATUS_READY;
            });
          } else {
            this.status = BootstrapStatus.STATUS_READY;
          }
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

import { exec } from "child_process";
import * as dotenv from "dotenv";
import express from "express";
import fs from "fs";
import { createProxyMiddleware } from "http-proxy-middleware";
import path from "path";
import ViteExpress from "vite-express";
dotenv.config({ path: process.cwd() + "/../.env" });

const app = express();

app.use("/twirp", createProxyMiddleware({ target: process.env.BASE_URL, changeOrigin: true }));

app.use("/bootstrap", (req, res) => {
  console.log(process.cwd());
  const protoPath = path.resolve(process.cwd(), "../proto");
  const outPath = path.resolve(process.cwd(), "../app/src/client/protoc");
  console.log("protoPath", protoPath);

  fs.mkdir(outPath, { recursive: true }, (error) => {
    if (error) {
      console.error("An error occurred:", error);
    } else {
      console.log("Directory created or already exists");
    }
  });

  exec(`protoc --ts_out ${outPath} --ts_opt long_type_bigint -I${protoPath} $(find ${protoPath} -iname "*.proto")`, (error, stdout, stderr) => {
    if (error) {
      res.send(`exec error: ${error}`);
      return;
    }

    exec(`npm run build`, (error, stdout, stderr) => {
      if (error) {
        res.send(`exec error: ${error}`);
        return;
      }

      res.send(`stdout: ${stdout}`);
      //console.error(`stderr: ${stderr}`);
    });
  });
});

ViteExpress.listen(app, 3000, () => console.log("Server is listening on port 3000..."));
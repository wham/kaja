import * as dotenv from "dotenv";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import ViteExpress from "vite-express";
import { createApiServer } from "../shared/api.twirp";
import { Bootstrapper } from "./bootstrapper";
dotenv.config({ path: process.cwd() + "/../.env" });

const app = express();
const bootstrapper = new Bootstrapper();

const server = createApiServer({
  async Bootstrap(ctx, request) {
    return bootstrapper.bootstrap(request);
  }
});

server.withPrefix("/api");

app.post(server.matchingPath(), server.httpHandler());

app.use("/twirp", createProxyMiddleware({ target: process.env.BASE_URL, changeOrigin: true }));

ViteExpress.listen(app, 3000, () => console.log("Server is listening on port 3000..."));

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { startStaticPreviewServer } from "../src/static-preview-server.js";

const rawRequest = (url, requestPath, method = "GET") =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: requestPath,
        method,
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      },
    );
    request.once("error", reject);
    request.end();
  });

test("static preview server stays inside its root and only accepts reads", async (t) => {
  const parent = await fs.mkdtemp(
    path.join(os.tmpdir(), "gdevelop-static-test-"),
  );
  const root = path.join(parent, "preview");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "index.html"), "<h1>preview</h1>");
  await fs.writeFile(path.join(parent, "secret.txt"), "secret");
  const server = await startStaticPreviewServer({ rootDirectory: root });
  t.after(async () => {
    await server.close();
    await fs.rm(parent, { recursive: true, force: true });
  });

  assert.equal((await fetch(server.url)).status, 200);
  assert.equal(await rawRequest(server.url, "/..%2Fsecret.txt"), 400);
  assert.equal(await rawRequest(server.url, "/", "POST"), 405);
  assert.equal(await rawRequest(server.url, "/", "HEAD"), 200);
});

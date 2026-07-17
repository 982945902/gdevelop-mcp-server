import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".wav", "audio/wav"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
]);

const resolveRequestPath = (rootDirectory, requestUrl) => {
  const url = new URL(requestUrl || "/", "http://127.0.0.1");
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const resolvedRoot = path.resolve(rootDirectory);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (
    resolvedPath !== resolvedRoot &&
    !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    return null;
  }
  return resolvedPath;
};

export const startStaticPreviewServer = ({
  rootDirectory,
  host = "127.0.0.1",
}) =>
  new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        response.writeHead(405).end("Method not allowed");
        return;
      }
      const filename = resolveRequestPath(rootDirectory, request.url);
      if (!filename) {
        response.writeHead(400).end("Bad request");
        return;
      }

      fs.stat(filename, (statError, stats) => {
        if (statError || !stats.isFile()) {
          response.writeHead(404).end("Not found");
          return;
        }
        response.setHeader("Cache-Control", "no-store");
        response.setHeader(
          "Content-Type",
          contentTypes.get(path.extname(filename).toLowerCase()) ||
            "application/octet-stream",
        );
        const stream = fs.createReadStream(filename);
        stream.on("error", () => {
          if (!response.headersSent) response.writeHead(500);
          response.end("Unable to read file");
        });
        if (request.method === "HEAD") {
          response.end();
          stream.destroy();
        } else {
          stream.pipe(response);
        }
      });
    });

    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      if (!port) {
        server.close();
        reject(new Error("Unable to determine preview server port."));
        return;
      }
      resolve({
        url: `http://${host}:${port}/`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) =>
              error ? closeReject(error) : closeResolve(),
            );
            server.closeAllConnections?.();
          }),
      });
    });
  });

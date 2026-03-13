import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import { AleoVeilRelayerService } from "./relayer-service.mjs";

function parseBoolean(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  return /^(1|true|yes|on)$/i.test(String(value));
}

function writeJson(response, statusCode, payload) {
  if (response.headersSent || response.writableEnded) {
    return;
  }

  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readBody(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBodyBytes) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    request.on("error", reject);
  });
}

export function createRelayerServer({
  service = new AleoVeilRelayerService({
    networkHost: process.env.ALEOVEIL_NETWORK_HOST ?? "http://127.0.0.1:3030",
    waitForConfirmation: parseBoolean(process.env.ALEOVEIL_RELAYER_WAIT_FOR_CONFIRMATION, true)
  }),
  maxBodyBytes = 1_000_000
} = {}) {
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        writeJson(response, 200, {
          ok: true,
          feeMode: service.feeMode,
          waitForConfirmation: service.waitForConfirmation
        });
        return;
      }

      if (request.method === "POST" && request.url === "/relay") {
        const rawBody = await readBody(request, maxBodyBytes);
        const submission = rawBody === "" ? {} : JSON.parse(rawBody);
        const result = await service.submit(submission);

        writeJson(response, 200, {
          ok: true,
          result
        });
        return;
      }

      writeJson(response, 404, {
        ok: false,
        error: "route not found"
      });
    } catch (error) {
      if (response.headersSent || response.writableEnded) {
        return;
      }

      const message = String(error?.message ?? error);
      const statusCode = /submit|network|confirmation/i.test(message) ? 502 : 400;

      writeJson(response, statusCode, {
        ok: false,
        error: message
      });
    }
  });

  return server;
}

export function startRelayerServer({ host = "127.0.0.1", port = 4040, ...options } = {}) {
  const server = createRelayerServer(options);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.ALEOVEIL_RELAYER_BIND ?? "127.0.0.1";
  const port = Number(process.env.ALEOVEIL_RELAYER_PORT ?? "4040");

  startRelayerServer({ host, port })
    .then(() => {
      process.stdout.write(`aleoveil relayer listening on http://${host}:${port}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.message ?? error)}\n`);
      process.exitCode = 1;
    });
}

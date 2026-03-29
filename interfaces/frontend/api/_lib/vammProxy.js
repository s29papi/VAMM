function jsonResponse(res, statusCode, payload) {
  res.status(statusCode).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function readRequestBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string" && req.body.trim()) {
    return JSON.parse(req.body);
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

export async function proxyVammRequest(req, res, upstreamPath) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return jsonResponse(res, 405, { error: { message: "Method Not Allowed" } });
  }

  const upstreamBaseUrl = (process.env.VAMM_MAKER_API_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (!upstreamBaseUrl) {
    return jsonResponse(res, 500, {
      error: { message: "Missing server environment variable: VAMM_MAKER_API_BASE_URL" },
    });
  }

  const apiKey = (process.env.VAMM_API_KEY ?? "").trim();
  const payload = await readRequestBody(req);
  const upstreamResponse = await fetch(`${upstreamBaseUrl}${upstreamPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  const text = await upstreamResponse.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (parsed && typeof parsed === "object") {
    return jsonResponse(res, upstreamResponse.status, parsed);
  }

  res.status(upstreamResponse.status);
  res.setHeader("Content-Type", upstreamResponse.headers.get("content-type") ?? "text/plain; charset=utf-8");
  res.end(text);
}

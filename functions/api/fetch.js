const MAX_BYTES = 1_000_000;
const ALLOWED_HOSTS = new Set([
  "raw.githubusercontent.com",
  "gist.githubusercontent.com"
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

function normalizeGitHubUrl(input) {
  const url = new URL(input);
  if (url.protocol !== "https:") throw new Error("Only HTTPS URLs are allowed.");
  if (url.hostname === "github.com") {
    // Accept only regular blob URLs, then convert them to the raw host.
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 5 || parts[2] !== "blob") {
      throw new Error("Use a GitHub file URL containing /blob/, or a raw GitHub URL.");
    }
    url.hostname = "raw.githubusercontent.com";
    parts.splice(2, 1);
    url.pathname = "/" + parts.join("/");
    url.search = "";
    url.hash = "";
  }
  if (url.hostname === "gist.github.com") {
    throw new Error("Use the raw URL from the Gist's Raw button.");
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error("For safety, URL fetching supports raw.githubusercontent.com and gist.githubusercontent.com only.");
  }
  if (url.username || url.password || url.port) throw new Error("Credentials and custom ports are not allowed.");
  return url;
}

export async function onRequestGet({ request }) {
  const requestUrl = new URL(request.url);
  const input = requestUrl.searchParams.get("url");
  if (!input) return json({ error: "Missing url parameter." }, 400);

  let url;
  try {
    url = normalizeGitHubUrl(input);
  } catch (err) {
    return json({ error: err.message || "Invalid URL." }, 400);
  }

  try {
    const response = await fetch(url.href, {
      method: "GET",
      redirect: "manual",
      headers: { "user-agent": "AxomJB-Redline-Source-Inspector/1.0", "accept": "text/plain,*/*;q=0.5" },
      cf: { cacheTtl: 0 }
    });

    // Redirects are rejected instead of followed, avoiding host-validation bypasses.
    if (response.status >= 300 && response.status < 400) {
      return json({ error: "The source host redirected this URL. Use its final raw-file URL directly." }, 400);
    }
    if (!response.ok) return json({ error: `Source host returned HTTP ${response.status}.` }, 502);

    const contentType = response.headers.get("content-type") || "";
    if (/text\/html/i.test(contentType)) {
      return json({ error: "That URL returned an HTML page, not raw source. Use the raw-file URL." }, 415);
    }
    const length = Number(response.headers.get("content-length") || "0");
    if (length > MAX_BYTES) return json({ error: "Source exceeds the 1 MB limit." }, 413);

    const reader = response.body?.getReader();
    if (!reader) return json({ error: "Empty source response." }, 502);
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        return json({ error: "Source exceeds the 1 MB limit." }, 413);
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
    const source = new TextDecoder("utf-8", { fatal: false }).decode(merged);
    return json({ source, bytes: total, sourceUrl: url.href });
  } catch {
    return json({ error: "Could not reach the source host. Check that the file is public and the URL is correct." }, 502);
  }
}

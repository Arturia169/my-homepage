export async function onRequest({ request }) {
  const url = new URL(request.url);
  const u = url.searchParams.get("u");
  if (!u) return json(400, { error: "Missing u" });

  let target;
  try {
    target = new URL(u);
  } catch {
    return json(400, { error: "Bad u" });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return json(400, { error: "Bad protocol" });
  }

  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

  let html = "";
  let status = 0;
  try {
    const resp = await fetch(target.toString(), {
      headers: {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    status = resp.status;
    const ct = resp.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("text/html")) {
      return json(200, {
        url: target.toString(),
        status,
        hostname: target.hostname,
        title: null,
        icon: null,
      });
    }

    const text = await resp.text();
    html = text.slice(0, 512_000);
  } catch {
    return json(200, {
      url: target.toString(),
      status,
      hostname: target.hostname,
      title: null,
      icon: null,
    });
  }

  const title = extractTitle(html);
  const icon = extractIconUrl(html, target);

  return new Response(
    JSON.stringify(
      {
        url: target.toString(),
        status,
        hostname: target.hostname,
        title: title || null,
        icon: icon || null,
      },
      null,
      2
    ),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    }
  );
}

function json(status, obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const t = decodeHtml(m[1]).trim().replace(/\s+/g, " ");
  return t || null;
}

function extractIconUrl(html, baseUrl) {
  const linkRe = /<link\b[^>]*>/gi;
  const candidates = [];
  let match;
  while ((match = linkRe.exec(html))) {
    const tag = match[0];
    const rel = getAttr(tag, "rel");
    const href = getAttr(tag, "href");
    if (!rel || !href) continue;
    const relLower = rel.toLowerCase();
    if (!relLower.includes("icon")) continue;
    candidates.push(href);
  }
  const pick = candidates.find(Boolean);
  if (!pick) return null;
  try {
    return new URL(pick, baseUrl).toString();
  } catch {
    return null;
  }
}

function getAttr(tag, name) {
  const re = new RegExp(`${name}\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`, "i");
  const m = tag.match(re);
  return (m?.[2] ?? m?.[3] ?? m?.[4] ?? "").trim() || null;
}

function decodeHtml(s) {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

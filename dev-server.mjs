import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const [k, v] = a.slice(2).split("=");
  args.set(k, v ?? "true");
}

const port = Number(args.get("port") ?? process.env.PORT ?? "8788");
const host = String(args.get("host") ?? process.env.HOST ?? "127.0.0.1");

const VERSION = "local-dev-server-2026-01-28";

function json(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function text(res, status, body, extraHeaders) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...(extraHeaders ?? {}),
  });
  res.end(body);
}

function getEnvList(name) {
  return String(process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    return d.toISOString();
  } catch {
    return iso;
  }
}

async function handleLive(res) {
  const BILIBILI_ROOMS = getEnvList("BILIBILI_ROOMS");
  const YT_CHANNELS = getEnvList("YT_CHANNELS");
  const YT_KEY = process.env.YT_API_KEY;

  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

  const bili = await Promise.all(
    BILIBILI_ROOMS.map(async (room_id) => {
      const infoUrl = `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${encodeURIComponent(room_id)}`;
      const infoRes = await fetch(infoUrl, {
        headers: {
          "User-Agent": ua,
          Referer: `https://live.bilibili.com/${room_id}`,
        },
      });
      const infoJson = await infoRes.json().catch(() => null);
      const d = infoJson?.data || {};

      let uname = null;
      try {
        const anchorUrl = `https://api.live.bilibili.com/live_user/v1/UserInfo/get_anchor_in_room?roomid=${encodeURIComponent(room_id)}`;
        const anchorRes = await fetch(anchorUrl, {
          headers: {
            "User-Agent": ua,
            Referer: `https://live.bilibili.com/${room_id}`,
          },
        });
        const anchorJson = await anchorRes.json().catch(() => null);
        uname = anchorJson?.data?.info?.uname ?? null;
      } catch {}

      return {
        platform: "bilibili",
        room_id,
        uname,
        title: d.title || null,
        live_status: d.live_status,
        cover: d.user_cover || d.keyframe || null,
        url: `https://live.bilibili.com/${room_id}`,
      };
    })
  );

  const youtube = [];
  const youtube_chatroom = [];

  async function ytSearch(channelId, eventType) {
    const params = new URLSearchParams({
      part: "snippet",
      channelId,
      eventType,
      type: "video",
      order: "date",
      maxResults: "10",
      key: YT_KEY ?? "",
    });
    const url = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
    const r = await fetch(url);
    const j = await r.json().catch(() => null);
    const items = j?.items || [];
    return items.map((it) => {
      const vid = it?.id?.videoId;
      const sn = it?.snippet || {};
      return {
        platform: "youtube",
        channelId,
        eventType,
        title: sn.title || null,
        channelTitle: sn.channelTitle || null,
        publishedAt: sn.publishedAt || null,
        thumb: sn?.thumbnails?.medium?.url || null,
        url: vid ? `https://www.youtube.com/watch?v=${vid}` : null,
      };
    });
  }

  if (YT_KEY) {
    for (const channelId of YT_CHANNELS) {
      const live = await ytSearch(channelId, "live");
      const upcoming = await ytSearch(channelId, "upcoming");

      const isChatroom = (x) => {
        const t = String(x.title || "").toLowerCase();
        const year = new Date(x.publishedAt).getFullYear();
        const looksLikeChat =
          t.includes("free chat") ||
          t.includes("聊天室") ||
          t.includes("chatroom") ||
          t.includes("chat");
        return looksLikeChat || year < 2024;
      };

      youtube.push(...live);
      for (const x of upcoming) {
        if (isChatroom(x)) youtube_chatroom.push(x);
        else youtube.push(x);
      }
    }
  }

  json(res, 200, {
    version: VERSION,
    updated_at: fmtTime(new Date().toISOString()),
    bili,
    youtube,
    youtube_chatroom,
  });
}

async function handleImg(req, res, url) {
  const u = url.searchParams.get("u");
  if (!u) return text(res, 400, "Missing u");

  let target;
  try {
    target = new URL(u);
  } catch {
    return text(res, 400, "Bad u");
  }

  const allowedHosts = new Set([
    "i0.hdslb.com",
    "i1.hdslb.com",
    "i2.hdslb.com",
    "i3.hdslb.com",
    "i4.hdslb.com",
    "i5.hdslb.com",
    "i6.hdslb.com",
    "i7.hdslb.com",
    "i8.hdslb.com",
    "i9.hdslb.com",
    "img.ytimg.com",
    "i.ytimg.com",
  ]);
  if (!allowedHosts.has(target.hostname)) return text(res, 403, "Host not allowed");

  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
  const headers = new Headers({
    "User-Agent": ua,
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    Referer: "https://live.bilibili.com/",
  });
  const upstream = await fetch(target.toString(), { headers });
  if (!upstream.ok) return text(res, 502, `Upstream error: ${upstream.status}`);

  const ct = upstream.headers.get("content-type") || "image/jpeg";
  res.writeHead(200, {
    "content-type": ct,
    "cache-control": "public, max-age=3600",
  });

  if (!upstream.body) return res.end();
  Readable.fromWeb(upstream.body).pipe(res);
}

async function handleMeta(res, url) {
  const u = url.searchParams.get("u");
  if (!u) return json(res, 400, { error: "Missing u" });

  let target;
  try {
    target = new URL(u);
  } catch {
    return json(res, 400, { error: "Bad u" });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return json(res, 400, { error: "Bad protocol" });
  }

  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

  let html = "";
  let status = 0;
  try {
    const resp = await fetch(target.toString(), {
      headers: {
        "User-Agent": ua,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    status = resp.status;
    const ct = resp.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("text/html")) {
      return json(res, 200, {
        url: target.toString(),
        status,
        hostname: target.hostname,
        title: null,
        icon: null,
      });
    }

    const textBody = await resp.text();
    html = textBody.slice(0, 512_000);
  } catch {
    return json(res, 200, {
      url: target.toString(),
      status,
      hostname: target.hostname,
      title: null,
      icon: null,
    });
  }

  const title = extractTitle(html);
  const icon = extractIconUrl(html, target);
  return json(res, 200, {
    url: target.toString(),
    status,
    hostname: target.hostname,
    title: title || null,
    icon: icon || null,
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
    if (!rel.toLowerCase().includes("icon")) continue;
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

async function serveStatic(res, path) {
  const full = join(__dirname, path);
  const buf = await readFile(full);
  const ext = extname(path).toLowerCase();
  const ct =
    ext === ".html"
      ? "text/html; charset=utf-8"
      : ext === ".css"
        ? "text/css; charset=utf-8"
        : ext === ".js"
          ? "text/javascript; charset=utf-8"
          : "application/octet-stream";
  res.writeHead(200, { "content-type": ct, "cache-control": "no-store" });
  res.end(buf);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  try {
    if (url.pathname === "/api/live") return await handleLive(res);
    if (url.pathname === "/api/img") return await handleImg(req, res, url);
    if (url.pathname === "/api/meta") return await handleMeta(res, url);
    if (url.pathname === "/" || url.pathname === "/index.html") return await serveStatic(res, "index.html");
    return text(res, 404, "Not Found");
  } catch (e) {
    return json(res, 500, { error: String(e?.stack ?? e) });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`dev server on http://${host}:${port}/\n`);
});

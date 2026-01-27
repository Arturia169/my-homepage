export async function onRequest({ request }) {
  const url = new URL(request.url);
  const u = url.searchParams.get("u");
  if (!u) return new Response("Missing u", { status: 400 });

  let target;
  try {
    target = new URL(u);
  } catch {
    return new Response("Bad u", { status: 400 });
  }

  // 简单安全限制：只允许代理这些常见域名（避免被滥用）
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
  if (!allowedHosts.has(target.hostname)) {
    return new Response("Host not allowed", { status: 403 });
  }

  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

  // 给 B站/YouTube 这类资源加上更像“正常访问”的头
  const headers = new Headers({
    "User-Agent": ua,
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Referer": "https://live.bilibili.com/",
  });

  const resp = await fetch(target.toString(), { headers });

  if (!resp.ok) {
    return new Response(`Upstream error: ${resp.status}`, { status: 502 });
  }

  // 透传图片流
  const ct = resp.headers.get("content-type") || "image/jpeg";
  return new Response(resp.body, {
    headers: {
      "content-type": ct,
      // 缓存一下，减少重复请求
      "cache-control": "public, max-age=3600",
    },
  });
}

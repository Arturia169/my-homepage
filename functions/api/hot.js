export async function onRequest() {
  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

  const biliUrl = "https://api.bilibili.com/x/web-interface/popular?pn=1&ps=20";
  const biliResp = await fetchJson(biliUrl, {
    "User-Agent": ua,
    Referer: "https://www.bilibili.com/",
  });
  const biliItems = biliResp.json?.data?.list || [];
  const bili = biliItems.map((x) => ({
    title: x?.title || null,
    url: x?.bvid ? `https://www.bilibili.com/video/${x.bvid}` : x?.short_link || null,
    owner: x?.owner?.name || null,
    view: x?.stat?.view ?? null,
    like: x?.stat?.like ?? null,
    cover: x?.pic || null,
  }));

  const zhihuUrl =
    "https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50&desktop=true";
  const zhihuResp = await fetchJson(zhihuUrl, {
    "User-Agent": ua,
    Referer: "https://www.zhihu.com/hot",
  });
  const zhihuItems = zhihuResp.json?.data || [];
  const zhihu = zhihuItems.map((x) => {
    const targetUrl = x?.target?.url || "";
    const qid = targetUrl.match(/questions?\\/(\\d+)/)?.[1] || "";
    return {
      title: x?.target?.title || null,
      url: qid ? `https://www.zhihu.com/question/${qid}` : targetUrl || null,
      hot: x?.detail_text || null,
    };
  });

  return json(200, {
    version: "hot-api-v1-2026-01-28",
    updated_at: new Date().toISOString(),
    bili,
    zhihu,
  });
}

async function fetchJson(url, headers) {
  const r = await fetch(url, { headers });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, json: j };
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

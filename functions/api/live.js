export async function onRequest({ env }) {
  const VERSION = "live-api-v5-split-chatroom-2026-01-28";

  const BILIBILI_ROOMS = (env.BILIBILI_ROOMS || "")
    .split(",").map(s => s.trim()).filter(Boolean);

  const YT_CHANNELS = (env.YT_CHANNELS || "")
    .split(",").map(s => s.trim()).filter(Boolean);

  const YT_KEY = env.YT_API_KEY;

  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

  // ========== B站：直播间信息 + 主播uname ==========
  const bili = await Promise.all(BILIBILI_ROOMS.map(async (room_id) => {
    // 直播间信息
    const infoUrl = `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${encodeURIComponent(room_id)}`;
    const infoRes = await fetch(infoUrl, {
      headers: { "User-Agent": ua, "Referer": `https://live.bilibili.com/${room_id}` }
    });
    const infoJson = await infoRes.json().catch(() => null);
    const d = infoJson?.data || {};

    // 主播信息：get_anchor_in_room
    let uname = null;
    try {
      const anchorUrl = `https://api.live.bilibili.com/live_user/v1/UserInfo/get_anchor_in_room?roomid=${encodeURIComponent(room_id)}`;
      const anchorRes = await fetch(anchorUrl, {
        headers: { "User-Agent": ua, "Referer": `https://live.bilibili.com/${room_id}` }
      });
      const anchorJson = await anchorRes.json().catch(() => null);
      uname = anchorJson?.data?.info?.uname ?? null;
    } catch {}

    return {
      platform: "bilibili",
      room_id,
      uname, // null 也会输出，便于前端处理
      title: d.title || null,
      live_status: d.live_status, // 0未开播 1开播 2轮播
      cover: d.user_cover || d.keyframe || null,
      url: `https://live.bilibili.com/${room_id}`,
    };
  }));

  // ========== YouTube：拆分 live / upcoming / chatroom ==========
  const youtube = [];            // 真·直播 + 真·预告（较新）
  const youtube_chatroom = [];   // Free Chat / 常驻聊天室 / 老年份长期项

  if (YT_KEY) {
    for (const channelId of YT_CHANNELS) {
      const live = await ytSearch(channelId, "live", YT_KEY);
      const upcoming = await ytSearch(channelId, "upcoming", YT_KEY);

      const isChatroom = (x) => {
        const t = (x.title || "").toLowerCase();
        const year = new Date(x.publishedAt).getFullYear();

        const looksLikeChat =
          t.includes("free chat") ||
          t.includes("聊天室") ||
          t.includes("chatroom") ||
          t.includes("chat");

        // ✅ 规则：包含聊天室关键词 或 发布年份太老 → 归类为常驻聊天室
        return looksLikeChat || year < 2024;
      };

      youtube.push(...live);

      for (const x of upcoming) {
        if (isChatroom(x)) youtube_chatroom.push(x);
        else youtube.push(x);
      }
    }
  }

  // 调试期：禁缓存，避免看见旧数据；稳定后你可改回 max-age=60
  return new Response(JSON.stringify({
    version: VERSION,
    updated_at: new Date().toISOString(),
    bili,
    youtube,
    youtube_chatroom
  }, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function ytSearch(channelId, eventType, key) {
  const params = new URLSearchParams({
    part: "snippet",
    channelId,
    eventType,
    type: "video",
    order: "date",
    maxResults: "10",
    key
  });

  const url = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
  const r = await fetch(url);
  const j = await r.json().catch(() => null);
  const items = j?.items || [];

  return items.map(it => {
    const vid = it?.id?.videoId;
    const sn = it?.snippet || {};
    return {
      platform: "youtube",
      channelId,
      eventType, // live / upcoming
      title: sn.title || null,
      channelTitle: sn.channelTitle || null,
      publishedAt: sn.publishedAt || null,
      thumb: sn?.thumbnails?.medium?.url || null,
      url: vid ? `https://www.youtube.com/watch?v=${vid}` : null
    };
  });
}

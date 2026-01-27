export async function onRequest({ env, request }) {
  const VERSION = "live-api-v4-anchor-filter-2026-01-28";

  const BILIBILI_ROOMS = (env.BILIBILI_ROOMS || "")
    .split(",").map(s => s.trim()).filter(Boolean);

  const YT_CHANNELS = (env.YT_CHANNELS || "")
    .split(",").map(s => s.trim()).filter(Boolean);

  const YT_KEY = env.YT_API_KEY;

  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

  // ========== B站：用 get_anchor_in_room 直接拿 uname ==========
  const bili = await Promise.all(BILIBILI_ROOMS.map(async (room_id) => {
    // 直播间信息
    const infoUrl = `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${encodeURIComponent(room_id)}`;
    const infoRes = await fetch(infoUrl, { headers: { "User-Agent": ua, "Referer": `https://live.bilibili.com/${room_id}` } });
    const infoJson = await infoRes.json().catch(() => null);
    const d = infoJson?.data || {};

    // 主播信息（拿 uname）
    let uname = null;
    try {
      const anchorUrl = `https://api.live.bilibili.com/live_user/v1/UserInfo/get_anchor_in_room?roomid=${encodeURIComponent(room_id)}`;
      const anchorRes = await fetch(anchorUrl, { headers: { "User-Agent": ua, "Referer": `https://live.bilibili.com/${room_id}` } });
      const anchorJson = await anchorRes.json().catch(() => null);
      uname = anchorJson?.data?.info?.uname ?? null;
    } catch {}

    return {
      platform: "bilibili",
      room_id,
      uname,                    // ✅ 保证字段存在（null 也会输出）
      title: d.title || null,
      live_status: d.live_status,
      cover: d.user_cover || d.keyframe || null,
      url: `https://live.bilibili.com/${room_id}`,
    };
  }));

  // ========== YouTube：过滤 Free Chat / 老年份 upcoming ==========
  const youtube = [];
  if (YT_KEY) {
    for (const channelId of YT_CHANNELS) {
      const live = await ytSearch(channelId, "live", YT_KEY);
      const upcoming = await ytSearch(channelId, "upcoming", YT_KEY);

      const cleanUpcoming = upcoming.filter(x => {
        const year = new Date(x.publishedAt).getFullYear();
        const t = (x.title || "").toLowerCase();

        const looksLikeChat =
          t.includes("free chat") ||
          t.includes("聊天室") ||
          t.includes("chatroom") ||
          t.includes("chat");

        // ✅ 过滤：老年份 or 聊天室
        if (year < 2024) return false;
        if (looksLikeChat) return false;
        return true;
      });

      youtube.push(...live, ...cleanUpcoming);
    }
  }

  // 调试阶段建议 no-store，确认没缓存干扰；稳定后你再改回 max-age=60
  return new Response(JSON.stringify({
    version: VERSION,
    updated_at: new Date().toISOString(),
    bili,
    youtube
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
      eventType,
      title: sn.title || null,
      channelTitle: sn.channelTitle || null,
      publishedAt: sn.publishedAt || null,
      thumb: sn?.thumbnails?.medium?.url || null,
      url: vid ? `https://www.youtube.com/watch?v=${vid}` : null
    };
  });
}

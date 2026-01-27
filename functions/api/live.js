export async function onRequest({ env }) {
  const BILIBILI_ROOMS = (env.BILIBILI_ROOMS || "")
    .split(",").map(s => s.trim()).filter(Boolean);

  const YT_CHANNELS = (env.YT_CHANNELS || "")
    .split(",").map(s => s.trim()).filter(Boolean);

  const YT_KEY = env.YT_API_KEY;

  // ========== B站：增强版（补 uname） ==========
  const bili = await Promise.all(BILIBILI_ROOMS.map(async (room_id) => {
    const infoUrl = `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${encodeURIComponent(room_id)}`;
    const infoRes = await fetch(infoUrl, { headers: { "Referer": `https://live.bilibili.com/${room_id}` } });
    const infoJson = await infoRes.json().catch(() => null);
    const d = infoJson?.data || {};

    // 通过 room_init 拿 uid，再查用户名（更稳）
    let uname = d.uname;
    try {
      const initUrl = `https://api.live.bilibili.com/room/v1/Room/room_init?id=${encodeURIComponent(room_id)}`;
      const initRes = await fetch(initUrl);
      const initJson = await initRes.json().catch(() => null);
      const uid = initJson?.data?.uid;
      if (uid) {
        const userUrl = `https://api.bilibili.com/x/space/acc/info?mid=${encodeURIComponent(uid)}`;
        const userRes = await fetch(userUrl);
        const userJson = await userRes.json().catch(() => null);
        uname = userJson?.data?.name || uname;
      }
    } catch {}

    return {
      platform: "bilibili",
      room_id,
      uname,
      title: d.title,
      live_status: d.live_status, // 0未开播 1开播 2轮播
      cover: d.user_cover || d.keyframe,
      url: `https://live.bilibili.com/${room_id}`,
    };
  }));

  // ========== YouTube：过滤“长期聊天室/置顶直播间” ==========
  const youtube = [];
  if (YT_KEY) {
    for (const channelId of YT_CHANNELS) {
      const live = await ytSearch(channelId, "live", YT_KEY);
      const upcoming = await ytSearch(channelId, "upcoming", YT_KEY);

      // 过滤掉发布年份很老的“Free Chat/聊天室”那种常驻项
      // 你这条 publishedAt 是 2020 年的，基本就是这种
      const cleanUpcoming = upcoming.filter(x => {
        const y = new Date(x.publishedAt).getFullYear();
        const t = (x.title || "").toLowerCase();
        const looksLikeChat = t.includes("free chat") || t.includes("聊天室") || t.includes("chat");
        return y >= 2024 && !looksLikeChat;
      });

      youtube.push(...live, ...cleanUpcoming);
    }
  }

  return new Response(JSON.stringify({
    updated_at: new Date().toISOString(),
    bili,
    youtube
  }, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60"
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
      title: sn.title,
      channelTitle: sn.channelTitle,
      publishedAt: sn.publishedAt,
      thumb: sn?.thumbnails?.medium?.url,
      url: vid ? `https://www.youtube.com/watch?v=${vid}` : null
    };
  });
}

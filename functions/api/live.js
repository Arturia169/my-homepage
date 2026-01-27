export async function onRequest({ env }) {
  const BILIBILI_ROOMS = (env.BILIBILI_ROOMS || "")
    .split(",").map(s => s.trim()).filter(Boolean);

  const YT_CHANNELS = (env.YT_CHANNELS || "")
    .split(",").map(s => s.trim()).filter(Boolean);

  const YT_KEY = env.YT_API_KEY;

  // B站
  const bili = await Promise.all(BILIBILI_ROOMS.map(async (room_id) => {
    const url = `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${encodeURIComponent(room_id)}`;
    const r = await fetch(url, { headers: { "Referer": `https://live.bilibili.com/${room_id}` } });
    const j = await r.json().catch(() => null);
    const d = j?.data || {};
    return {
      platform: "bilibili",
      room_id,
      uname: d.uname,
      title: d.title,
      live_status: d.live_status, // 0未开播 1开播 2轮播
      cover: d.user_cover || d.keyframe,
      url: `https://live.bilibili.com/${room_id}`,
    };
  }));

  // YouTube
  const youtube = [];
  if (YT_KEY) {
    for (const channelId of YT_CHANNELS) {
      youtube.push(...await ytSearch(channelId, "live", YT_KEY));
      youtube.push(...await ytSearch(channelId, "upcoming", YT_KEY));
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
    maxResults: "5",
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

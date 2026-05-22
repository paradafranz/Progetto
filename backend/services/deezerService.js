const LASTFM_KEY = process.env.LASTFM_API_KEY || "81d10cff1671e6863e32a35d349ea13a";
const TICKETMASTER_API_KEY = process.env.TICKETMASTER_API_KEY || "N4QlTsXPdn5D88TbCiDz4qpkcqkT2Qmr";
const LFM = (params) =>
  `https://ws.audioscrobbler.com/2.0/?${new URLSearchParams({ ...params, api_key: LASTFM_KEY, format: "json" })}`;

/* ── Deezer Global Charts (default home) ──────── */
export async function getCharts() {
  try {
    const res  = await fetch("https://api.deezer.com/chart/0/tracks?limit=50");
    const data = await res.json();
    if (!data?.data) return [];
    return data.data.map(mapTrack);
  } catch (err) {
    console.log("DEEZER CHARTS ERROR:", err.message);
    return [];
  }
}

/* ── Deezer Search ────────────────────────────── */
export async function getMusic({ query, order }) {
  try {
    let url = `https://api.deezer.com/search?q=${encodeURIComponent(query || "top")}`;
    if (order) url += `&order=${order}`;
    const res  = await fetch(url);
    const data = await res.json();
    if (!data?.data) return [];
    return data.data.map(mapTrack);
  } catch (err) {
    console.log("DEEZER ERROR:", err.message);
    return [];
  }
}

function mapTrack(m) {
  return {
    id:            m.id,
    title:         m.title,
    titleShort:    m.title_short,
    artist:        m.artist.name,
    artistId:      m.artist.id,
    artistPicture: m.artist.picture_medium || null,
    preview:       m.preview,
    cover:         m.album?.cover_medium || null,
    coverBig:      m.album?.cover_big    || null,
    coverXL:       m.album?.cover_xl     || null,
    album:         m.album?.title        || null,
    albumId:       m.album?.id           || null,
    duration:      m.duration            || null,
    rank:          m.rank                || null,
    explicit:      m.explicit_lyrics     || false,
    link:          m.link                || null,
    position:      m.position            || null,   // chart position if present
  };
}

/* ── Deezer Artist Info ───────────────────────── */
export async function getDeezerArtist(artistId) {
  try {
    const [aRes, topRes] = await Promise.all([
      fetch(`https://api.deezer.com/artist/${artistId}`),
      fetch(`https://api.deezer.com/artist/${artistId}/top?limit=10`),
    ]);
    const [a, top] = await Promise.all([aRes.json(), topRes.json()]);
    return {
      id:        a.id,
      name:      a.name,
      picture:   a.picture_xl || a.picture_big || null,
      fans:      a.nb_fan     || null,
      nbAlbum:   a.nb_album   || null,
      link:      a.link       || null,
      topTracks: (top.data || []).map(mapTrack),
    };
  } catch (err) {
    console.log("DEEZER ARTIST ERROR:", err.message);
    return null;
  }
}

/* ── Deezer Album Details ─────────────────────── */
export async function getDeezerAlbum(albumId) {
  try {
    const res  = await fetch(`https://api.deezer.com/album/${albumId}`);
    const a    = await res.json();
    return {
      id:          a.id,
      title:       a.title,
      cover:       a.cover_xl || a.cover_big || null,
      artist:      a.artist?.name || null,
      artistId:    a.artist?.id   || null,
      releaseDate: a.release_date || null,
      nbTracks:    a.nb_tracks    || null,
      duration:    a.duration     || null,
      fans:        a.fans         || null,
      genres:      (a.genres?.data || []).map(g => g.name),
      label:       a.label        || null,
      tracks:      (a.tracks?.data || []).map(mapTrack),
    };
  } catch (err) {
    console.log("DEEZER ALBUM ERROR:", err.message);
    return null;
  }
}

/* ── Last.fm Track Info (full) ────────────────── */
export async function getTrackDetails({ artist, title }) {
  const result = {
    playcount: null, listeners: null, loved: null,
    tags: [], wiki: null, similar: [], albumInfo: null,
  };
  if (!LASTFM_KEY) return result;
  try {
    const res  = await fetch(LFM({ method: "track.getInfo", artist, track: title }));
    const data = await res.json();
    const t    = data.track;
    if (!t) return result;

    result.playcount  = parseInt(t.playcount)  || null;
    result.listeners  = parseInt(t.listeners)  || null;
    result.loved      = parseInt(t.userloved)  || null;
    result.tags       = (t.toptags?.tag || []).slice(0, 5).map(g => g.name);
    result.wiki       = t.wiki?.content
      ? t.wiki.content.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().split(".").slice(0, 4).join(".") + "."
      : null;
    result.albumInfo  = t.album ? { title: t.album.title, mbid: t.album.mbid } : null;

    // Similar tracks via separate call
    const simRes  = await fetch(LFM({ method: "track.getSimilar", artist, track: title, limit: 5 }));
    const simData = await simRes.json();
    result.similar = (simData.similartracks?.track || []).slice(0, 5).map(s => ({
      title:  s.name,
      artist: s.artist?.name || "",
    }));
  } catch { /* optional */ }
  return result;
}

/* ── Last.fm Artist Info (full) ──────────────── */
export async function getArtistInfo({ artist }) {
  const result = {
    playcount: null, listeners: null, bio: null,
    tags: [], similar: [], topAlbums: [], topTracks: [],
  };
  if (!LASTFM_KEY) return result;
  try {
    const [infoRes, topAlbRes, topTrkRes] = await Promise.all([
      fetch(LFM({ method: "artist.getInfo", artist })),
      fetch(LFM({ method: "artist.getTopAlbums", artist, limit: 5 })),
      fetch(LFM({ method: "artist.getTopTracks", artist, limit: 10 })),
    ]);
    const [info, topAlb, topTrk] = await Promise.all([infoRes.json(), topAlbRes.json(), topTrkRes.json()]);

    const a = info.artist;
    if (a) {
      result.playcount  = parseInt(a.stats?.playcount)  || null;
      result.listeners  = parseInt(a.stats?.listeners)  || null;
      result.bio        = a.bio?.summary
        ? a.bio.summary.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().split(".").slice(0, 5).join(".") + "."
        : null;
      result.tags       = (a.tags?.tag || []).slice(0, 5).map(t => t.name);
      result.similar    = (a.similar?.artist || []).slice(0, 6).map(s => ({ name: s.name }));
    }
    result.topAlbums = (topAlb.topalbums?.album || []).slice(0, 5).map(al => ({
      title:     al.name,
      playcount: parseInt(al.playcount) || null,
      cover:     al.image?.find(i => i.size === "large")?.["#text"] || null,
    }));
    result.topTracks = (topTrk.toptracks?.track || []).slice(0, 10).map(t => ({
      title:     t.name,
      playcount: parseInt(t.playcount) || null,
      listeners: parseInt(t.listeners) || null,
    }));
  } catch { /* optional */ }
  return result;
}
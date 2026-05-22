import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors    from "cors";
import { getMovies, getMovieDetails }                           from "./services/tmdbService.js";
import { getMusic, getCharts, getTrackDetails, getArtistInfo,
         getDeezerArtist, getDeezerAlbum }                      from "./services/deezerService.js";

const app = express();
app.use(cors());
app.use(express.json());

/* ─────────────── FILM ─────────────────────────── */
app.post("/api/movies", async (req, res) => {
  const { query, genre, sortBy } = req.body;
  try { res.json(await getMovies({ query, genre, sortBy })); }
  catch (e) { console.log(e.message); res.json([]); }
});

app.get("/api/movie/:id", async (req, res) => {
  try { res.json(await getMovieDetails(req.params.id) || null); }
  catch (e) { console.log(e.message); res.json(null); }
});

/* ─────────────── MUSICA ───────────────────────── */
// Chart globale (default home)
app.get("/api/charts", async (req, res) => {
  try { res.json(await getCharts()); }
  catch (e) { console.log(e.message); res.json([]); }
});

// Ricerca
app.post("/api/music", async (req, res) => {
  const { query, order } = req.body;
  try { res.json(await getMusic({ query, order })); }
  catch (e) { console.log(e.message); res.json([]); }
});

// Dettagli traccia Last.fm
app.get("/api/track-info", async (req, res) => {
  const { artist, title } = req.query;
  try { res.json(await getTrackDetails({ artist, title })); }
  catch (e) { console.log(e.message); res.json({}); }
});

// Info artista (Deezer + Last.fm)
app.get("/api/artist/:id", async (req, res) => {
  try {
    const [deezer, lastfm] = await Promise.allSettled([
      getDeezerArtist(req.params.id),
      getArtistInfo({ artist: req.query.name || "" }),
    ]);
    res.json({
      deezer: deezer.status === "fulfilled" ? deezer.value : null,
      lastfm: lastfm.status === "fulfilled" ? lastfm.value : null,
    });
  } catch (e) { console.log(e.message); res.json({}); }
});

// Info album Deezer
app.get("/api/album/:id", async (req, res) => {
  try { res.json(await getDeezerAlbum(req.params.id) || null); }
  catch (e) { console.log(e.message); res.json(null); }
});

/* ─────────────────────────────────────────────── */
/* CONCERTI — tutto via Ticketmaster               */
/* ─────────────────────────────────────────────── */

function noKeyResponse(hint) {
  return [{
    id: "no-key", date: null, artistName: null, venue: null, city: null, country: null,
    url: null, ticketUrl: "https://www.ticketmaster.it", lineup: [], status: "info",
    noKeyMessage: `TICKETMASTER_API_KEY mancante nel .env. ${hint}`,
  }];
}

function mapTmEvent(e, fallbackCity) {
  const venue    = e._embedded?.venues?.[0] || {};
  const artists  = e._embedded?.attractions || [];
  const imgs     = e.images || [];
  const img      = imgs.find(i => i.ratio === "16_9" && i.width > 500)?.url
                || imgs.find(i => i.ratio === "16_9")?.url
                || imgs[0]?.url || null;
  return {
    id:         e.id,
    date:       e.dates?.start?.dateTime
             || (e.dates?.start?.localDate ? e.dates.start.localDate + "T20:00:00" : null),
    artistName: artists[0]?.name || e.name || null,
    artistImg:  img,
    venue:      venue.name          || null,
    city:       venue.city?.name    || fallbackCity || null,
    region:     venue.state?.name   || null,
    country:    venue.country?.name || null,
    address:    venue.address?.line1 || null,
    url:        e.url || null,
    ticketUrl:  e.url || null,
    priceMin:   e.priceRanges?.[0]?.min ?? null,
    priceMax:   e.priceRanges?.[0]?.max ?? null,
    currency:   e.priceRanges?.[0]?.currency ?? null,
    lineup:     artists.slice(1, 4).map(a => a.name),
    status:     e.dates?.status?.code === "cancelled" ? "cancelled" : "confirmed",
    genres:     [e.classifications?.[0]?.genre?.name,
                 e.classifications?.[0]?.subGenre?.name].filter(Boolean),
    isFeatured: e.dates?.status?.code === "onsale",
  };
}

async function tmFetch(params, TM_KEY) {
  params.apikey = TM_KEY;
  params.locale = "*";
  const url = `https://app.ticketmaster.com/discovery/v2/events.json?${new URLSearchParams(params)}`;
  console.log("TM →", url.replace(TM_KEY, "***"));
  const r    = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const data = await r.json();
  if (data.fault) throw new Error(data.fault.faultstring || "TM error");
  return data?._embedded?.events || [];
}

// ── Per artista ──────────────────────────────────
app.get("/api/concerts/artist", async (req, res) => {
  const artist    = (req.query.artist    || "").trim();
  const dateFrom  = req.query.dateFrom   || new Date().toISOString().split("T")[0];
  const dateTo    = req.query.dateTo     || "";
  const country   = req.query.country    || "";
  const size      = Math.min(parseInt(req.query.size) || 20, 50);
  const TM_KEY    = process.env.TICKETMASTER_API_KEY || "";

  if (!artist) return res.json([]);
  if (!TM_KEY) return res.json(noKeyResponse("Necessaria per la ricerca per artista."));

  try {
    const params = {
      keyword:            artist,
      classificationName: "Music",
      sort:               "date,asc",
      size:               String(size),
      startDateTime:      dateFrom + "T00:00:00Z",
    };
    if (dateTo)   params.endDateTime  = dateTo + "T23:59:59Z";
    if (country)  params.countryCode  = country.toUpperCase();

    const events = await tmFetch(params, TM_KEY);
    // Filtra per rilevanza: artista nel nome evento o attractions
    const filtered = events.filter(e => {
      const evName   = (e.name || "").toLowerCase();
      const attracts = (e._embedded?.attractions || []).map(a => a.name.toLowerCase());
      const q        = artist.toLowerCase();
      return evName.includes(q) || attracts.some(a => a.includes(q));
    });
    res.json((filtered.length ? filtered : events).map(e => mapTmEvent(e, null)));
  } catch (err) {
    console.log("TM ARTIST ERROR:", err.message);
    res.json([]);
  }
});

// ── Per città ────────────────────────────────────
app.get("/api/concerts/location", async (req, res) => {
  const city     = (req.query.city    || "").trim();
  const dateFrom = req.query.dateFrom || new Date().toISOString().split("T")[0];
  const dateTo   = req.query.dateTo   || "";
  const country  = req.query.country  || "";
  const genre    = req.query.genre    || "";
  const size     = Math.min(parseInt(req.query.size) || 30, 50);
  const TM_KEY   = process.env.TICKETMASTER_API_KEY || "";

  if (!city) return res.json([]);
  if (!TM_KEY) return res.json(noKeyResponse("Necessaria per la ricerca per città."));

  try {
    const params = {
      keyword:            city,
      classificationName: "Music",
      sort:               "date,asc",
      size:               String(size),
      startDateTime:      dateFrom + "T00:00:00Z",
    };
    if (dateTo)  params.endDateTime = dateTo + "T23:59:59Z";
    if (genre)   params.classificationName = genre;

    // Detect Italian cities → force countryCode
    const itCities = ["milan","roma","rome","torino","turin","napoli","naples",
                      "firenze","florence","bologna","venezia","venice","palermo","genova","bari"];
    const cityLow  = city.toLowerCase();
    if      (country)                               params.countryCode = country.toUpperCase();
    else if (itCities.some(c => cityLow.includes(c))) params.countryCode = "IT";

    const events = await tmFetch(params, TM_KEY);
    res.json(events.map(e => mapTmEvent(e, city)));
  } catch (err) {
    console.log("TM CITY ERROR:", err.message);
    res.json([]);
  }
});

/* ─────────────── YOUTUBE ──────────────────────── */
app.get("/api/youtube-id", async (req, res) => {
  const q = req.query.q || "";
  try {
    const videoId = await scrapeYouTubeId(q);
    res.json({ videoId });
  } catch (e) {
    console.log("YT SCRAPE ERROR:", e.message);
    res.json({ videoId: null });
  }
});

async function scrapeYouTubeId(query) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const r   = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const html  = await r.text();
  const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
  return match ? match[1] : null;
}

app.listen(3000, () => console.log("▶  http://localhost:3000"));
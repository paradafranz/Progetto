/* ══════════════════════════════════════════════
   Moodflix 2.0 — app.js
   ══════════════════════════════════════════════ */

const API = "http://localhost:3000";
let moviesCache = [];
let currentAudio = null;

/* ─────────────────────────────────────────────
   DATA STORE — evita JSON-in-HTML che si rompe
   con apostrofi e virgolette speciali.
   ds(obj) → salva obj, restituisce un ID numerico
   dg(id)  → recupera obj dall'ID
   ───────────────────────────────────────────── */
const _ds = {};
let _dsId = 0;
function ds(data) { const id = ++_dsId; _ds[id] = data; return id; }
function dg(id)   { return _ds[id]; }

/* ─────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────── */
const fmt = {
  dur(s) {
    if (!s) return null;
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  },
  runtime(m) {
    if (!m) return null;
    const h = Math.floor(m / 60), r = m % 60;
    return h ? `${h}h ${r}m` : `${r}m`;
  },
  year(d)   { return d ? d.split("-")[0] : null; },
  date(d)   {
    if (!d) return null;
    return new Date(d).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
  },
  number(n) { return n != null ? Number(n).toLocaleString("it") : null; },
  money(n)  {
    if (!n || n < 1000) return null;
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
    return `$${(n / 1e3).toFixed(0)}K`;
  },
};

function stars(score) {
  const f = Math.round((score / 10) * 5);
  return Array.from({ length: 5 }, (_, i) =>
    `<span class="star ${i < f ? "on" : "off"}">★</span>`
  ).join("");
}

function rankBar(rank) {
  const pct = Math.min(100, Math.round((rank / 1_000_000) * 100));
  return `<div class="rank-track"><div class="rank-fill" style="width:${pct}%"></div></div>`;
}

function providerLogo(p) {
  return `<div class="provider-chip" title="${p.provider_name}">
    <img src="https://image.tmdb.org/t/p/original${p.logo_path}" alt="${p.provider_name}"/>
    <span>${p.provider_name}</span>
  </div>`;
}

/* ─────────────────────────────────────────────
   TABS
   ───────────────────────────────────────────── */
function switchTab(name) {
  const tabs = ["movies", "music", "favorites"];
  document.querySelectorAll(".tab-btn").forEach((b, i) =>
    b.classList.toggle("active", tabs[i] === name)
  );
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.getElementById(`tab-${name}`).classList.add("active");
  if (name === "favorites") renderFavorites();
}

/* ─────────────────────────────────────────────
   RECENT SEARCHES
   ───────────────────────────────────────────── */
function saveRecent(type, q) {
  if (!q) return;
  const k = `recent_${type}`;
  const l = JSON.parse(localStorage.getItem(k) || "[]");
  localStorage.setItem(k, JSON.stringify([q, ...l.filter(x => x !== q)].slice(0, 6)));
  renderRecent(type);
}

function renderRecent(type) {
  const el = document.getElementById(`recent-${type}`);
  if (!el) return;
  const list = JSON.parse(localStorage.getItem(`recent_${type}`) || "[]");
  el.innerHTML = list.length ? `
    <span class="recent-label">Recenti:</span>
    ${list.map(q => {
      const qid = ds(q);
      return `<button class="recent-chip" onclick="applyRecent('${type}',${qid})">
        ${q} <span onclick="removeRecent(event,'${type}',${qid})">×</span>
      </button>`;
    }).join("")}` : "";
}

function applyRecent(type, id) {
  const q = dg(id);
  if (type === "movies") { document.getElementById("movie-input").value = q; searchMovies(); }
  else { document.getElementById("music-input").value = q; searchMusic(); }
}

function removeRecent(e, type, id) {
  e.stopPropagation();
  const q = dg(id);
  const k = `recent_${type}`;
  localStorage.setItem(k, JSON.stringify(
    JSON.parse(localStorage.getItem(k) || "[]").filter(x => x !== q)
  ));
  renderRecent(type);
}

/* ─────────────────────────────────────────────
   FAVORITES
   ───────────────────────────────────────────── */
function getFavs(type) {
  return JSON.parse(localStorage.getItem(`favs_${type}`) || "[]");
}

function isFav(type, item) {
  const key = type === "movies" ? item.id : `${item.artist}::${item.title}`;
  return getFavs(type).some(x =>
    (type === "movies" ? x.id : `${x.artist}::${x.title}`) === key
  );
}

function toggleFav(type, item) {
  const list = getFavs(type);
  const key  = type === "movies" ? item.id : `${item.artist}::${item.title}`;
  const idx  = list.findIndex(x =>
    (type === "movies" ? x.id : `${x.artist}::${x.title}`) === key
  );
  if (idx >= 0) list.splice(idx, 1);
  else list.unshift(item);
  localStorage.setItem(`favs_${type}`, JSON.stringify(list));
  return idx < 0;
}

function renderFavorites() {
  const movies = getFavs("movies");
  const music  = getFavs("music");
  document.getElementById("fav-movies").innerHTML = movies.length
    ? movies.map((m, i) => buildMovieCard(m, i)).join("")
    : `<div class="state-msg"><span>🎬</span>Nessun film nei preferiti.</div>`;
  document.getElementById("fav-music").innerHTML = music.length
    ? music.map((m, i) => buildMusicItem(m, i)).join("")
    : `<div class="state-msg"><span>🎵</span>Nessuna canzone.</div>`;
}

/* ─────────────────────────────────────────────
   MOVIES
   ───────────────────────────────────────────── */
async function searchMovies() {
  const query  = document.getElementById("movie-input").value.trim();
  const genre  = document.getElementById("movie-genre").value;
  const sortBy = document.getElementById("movie-sort").value;
  saveRecent("movies", query);

  const grid    = document.getElementById("movies");
  const loading = document.getElementById("movies-loading");
  grid.innerHTML = ""; loading.classList.remove("hidden");

  try {
    moviesCache = await fetch(`${API}/api/movies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, genre, sortBy }),
    }).then(r => r.json());
  } catch { moviesCache = []; }

  loading.classList.add("hidden");
  renderMovies(moviesCache);
}

function buildMovieCard(m, i) {
  const mid    = ds(m);
  const fav    = isFav("movies", m);
  const rating = m.rating ? `<span class="card-rating">⭐ ${m.rating}</span>` : "";
  const year   = m.year   ? `<span class="card-year">${m.year}</span>` : "";
  return `
    <div class="card" style="animation-delay:${i * 40}ms" onclick="openMovieModal(${m.id})">
      <img src="${m.poster || 'https://via.placeholder.com/300x450?text=?'}" alt="${m.title}" loading="lazy"/>
      <div class="card-overlay">
        <p class="card-title-overlay">${m.title}</p>
        <div class="card-overlay-meta">${rating}${year}</div>
        <div class="card-play-btn">▶ Dettagli</div>
      </div>
      <div class="card-footer">
        <span class="card-footer-title">${m.title}</span>
        <button class="fav-btn ${fav ? "active" : ""}" onclick="event.stopPropagation();onFavMovie(this,${mid})">❤</button>
      </div>
    </div>`;
}

function renderMovies(movies) {
  const grid = document.getElementById("movies");
  grid.innerHTML = movies.length
    ? movies.map((m, i) => buildMovieCard(m, i)).join("")
    : `<div class="state-msg"><span>🎬</span>Nessun film trovato.</div>`;
}

function onFavMovie(btn, id) {
  btn.classList.toggle("active", toggleFav("movies", dg(id)));
}

/* ─────────────────────────────────────────────
   MOVIE MODAL
   ───────────────────────────────────────────── */
async function openMovieModal(movieId) {
  const basic = moviesCache.find(m => m.id === movieId) || { id: movieId, title: "Film", poster: null };

  document.getElementById("modal-movie-content").innerHTML = `
    <div class="movie-modal-left"><img src="${basic.poster || ""}" alt="${basic.title}"/></div>
    <div class="modal-body">
      <div class="modal-title-row"><h3>${basic.title}</h3></div>
      ${["55%","40%","90%","80%","65%","50%"].map(w =>
        `<p class="skeleton-line" style="width:${w}"></p>`).join("")}
    </div>`;
  document.getElementById("modal-movie").classList.remove("hidden");
  document.body.style.overflow = "hidden";

  let d = null;
  try { d = await fetch(`${API}/api/movie/${movieId}`).then(r => r.json()); } catch {}
  document.getElementById("modal-movie-content").innerHTML = buildMovieHTML(d || basic);
}

function buildMovieHTML(d) {
  const year    = fmt.year(d.releaseDate);
  const runtime = fmt.runtime(d.runtime);
  const rating  = d.rating ? parseFloat(d.rating) : null;
  const fav     = isFav("movies", d);
  const mid     = ds(d);

  const genresBadges = (d.genres || []).map(g => `<span class="badge-genre">${g}</span>`).join("");
  const metaBadges   = [
    runtime && `<span class="badge-meta">⏱ ${runtime}</span>`,
    d.status && d.status !== "Released" && `<span class="badge-meta">${d.status}</span>`,
  ].filter(Boolean).join("");

  const crewHTML = [
    d.director && `<div class="crew-row"><span class="crew-label">🎬 Regia</span><span class="crew-value">${d.director}</span></div>`,
    d.writers?.length && `<div class="crew-row"><span class="crew-label">✍️ Sceneggiatura</span><span class="crew-value">${d.writers.join(", ")}</span></div>`,
    d.budget  && fmt.money(d.budget)  && `<div class="crew-row"><span class="crew-label">💰 Budget</span><span class="crew-value">${fmt.money(d.budget)}</span></div>`,
    d.revenue && fmt.money(d.revenue) && `<div class="crew-row"><span class="crew-label">📈 Incasso</span><span class="crew-value">${fmt.money(d.revenue)}</span></div>`,
  ].filter(Boolean).join("");

  const castHTML = (d.cast || []).map(c => `
    <div class="cast-item">
      <div class="cast-photo">
        ${c.photo ? `<img src="${c.photo}" alt="${c.name}" loading="lazy"/>` : `<div class="cast-photo-placeholder">${c.name[0]}</div>`}
      </div>
      <div class="cast-name">${c.name}</div>
      <div class="cast-char">${c.character || ""}</div>
    </div>`).join("");

  const { flatrate = [], rent = [], buy = [] } = d.providers || {};
  const provHTML = [
    flatrate.length && `<div class="prov-row"><span class="prov-type">▶ Streaming</span><div class="prov-chips">${flatrate.map(providerLogo).join("")}</div></div>`,
    rent.length     && `<div class="prov-row"><span class="prov-type">💳 Noleggio</span><div class="prov-chips">${rent.map(providerLogo).join("")}</div></div>`,
    buy.length      && `<div class="prov-row"><span class="prov-type">🛒 Acquisto</span><div class="prov-chips">${buy.map(providerLogo).join("")}</div></div>`,
  ].filter(Boolean).join("");

  const simHTML = (d.similar || []).map(s => `
    <div class="sim-card" onclick="openMovieModal(${s.id})">
      <img src="${s.poster || 'https://via.placeholder.com/150x225?text=?'}" alt="${s.title}" loading="lazy"/>
      <div class="sim-info">
        <div class="sim-title">${s.title}</div>
        ${s.rating ? `<div class="sim-rating">⭐ ${s.rating}</div>` : ""}
      </div>
    </div>`).join("");

  return `
    ${d.backdrop ? `<div class="movie-backdrop" style="background-image:url('${d.backdrop}')"><div class="movie-backdrop-fade"></div></div>` : ""}
    <div class="movie-modal-main">
      <div class="movie-modal-left">
        <img src="${d.poster || ""}" alt="${d.title}"/>
        ${rating !== null ? `
          <div class="rating-pill">
            <span class="rating-score">${d.rating}</span>
            <div class="rating-stars">${stars(rating)}</div>
            <span class="rating-votes">${fmt.number(d.voteCount)} voti</span>
          </div>` : ""}
        <button class="fav-btn-modal ${fav ? "active" : ""}" onclick="onFavMovieModal(this,${mid})">
          ${fav ? "❤️ Nei preferiti" : "🤍 Aggiungi ai preferiti"}
        </button>
      </div>
      <div class="modal-body">
        <div class="modal-title-row">
          <h3>${d.title}</h3>
          ${year ? `<span class="modal-year">${year}</span>` : ""}
        </div>
        ${d.originalTitle ? `<div class="modal-orig-title">${d.originalTitle}</div>` : ""}
        ${d.tagline ? `<p class="modal-tagline">"${d.tagline}"</p>` : ""}
        <div class="modal-badges">${genresBadges}${metaBadges}</div>
        <p class="modal-overview">${d.overview}</p>
        ${crewHTML ? `<div class="modal-crew-block">${crewHTML}</div>` : ""}
        ${castHTML ? `<div class="modal-section-title">Cast</div><div class="cast-grid">${castHTML}</div>` : ""}
        ${provHTML
          ? `<div class="modal-section-title">Dove guardarlo</div><div class="providers-block">${provHTML}</div>`
          : `<div class="no-providers">Nessuna piattaforma disponibile nella tua regione.</div>`}
        ${simHTML ? `<div class="modal-section-title">Film consigliati</div><div class="similar-row">${simHTML}</div>` : ""}
      </div>
    </div>`;
}

function onFavMovieModal(btn, id) {
  const m = dg(id);
  const added = toggleFav("movies", m);
  btn.classList.toggle("active", added);
  btn.textContent = added ? "❤️ Nei preferiti" : "🤍 Aggiungi ai preferiti";
  renderMovies(moviesCache);
}

function closeMovieModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById("modal-movie").classList.add("hidden");
  document.body.style.overflow = "";
}

/* ─────────────────────────────────────────────
   MUSIC — default = global charts
   ───────────────────────────────────────────── */
async function loadCharts() {
  const grid    = document.getElementById("music");
  const loading = document.getElementById("music-loading");
  const label   = document.getElementById("chart-label");
  grid.innerHTML = ""; loading.classList.remove("hidden");
  if (label) label.classList.remove("hidden");
  try {
    const data = await fetch(`${API}/api/charts`).then(r => r.json());
    loading.classList.add("hidden");
    renderMusic(data);
  } catch { loading.classList.add("hidden"); }
}

async function searchMusic() {
  const query   = document.getElementById("music-input").value.trim();
  const order   = document.getElementById("music-sort").value;
  const label   = document.getElementById("chart-label");

  if (!query) { if (label) label.classList.remove("hidden"); loadCharts(); return; }
  if (label) label.classList.add("hidden");
  saveRecent("music", query);

  const grid    = document.getElementById("music");
  const loading = document.getElementById("music-loading");
  grid.innerHTML = ""; loading.classList.remove("hidden");

  try {
    const data = await fetch(`${API}/api/music`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, order }),
    }).then(r => r.json());
    loading.classList.add("hidden");
    renderMusic(data);
  } catch { loading.classList.add("hidden"); }
}

function buildMusicItem(m, i) {
  const fav  = isFav("music", m);
  const mid  = ds(m);
  const aid  = ds({ id: m.artistId, name: m.artist });
  const alid = m.albumId ? ds({ id: m.albumId, title: m.album }) : null;
  const dur  = fmt.dur(m.duration);
  const cover = m.cover
    ? `<img class="music-cover" src="${m.cover}" alt="${m.title}" loading="lazy"/>`
    : `<div class="music-cover-placeholder">🎵</div>`;
  const pos = m.position ? `<span class="chart-pos">${m.position}</span>` : "";

  return `
    <div class="music-item" style="animation-delay:${i * 25}ms" onclick="openMusicModal(${mid})">
      <div class="music-cover-wrap">${pos}${cover}</div>
      <div class="music-info">
        <div class="music-title">${m.title}${m.explicit ? ` <span class="badge-explicit">E</span>` : ""}</div>
        <button class="artist-link" onclick="event.stopPropagation();openArtistModal(${aid})">${m.artist}</button>
        ${alid ? `<button class="album-link" onclick="event.stopPropagation();openAlbumModal(${alid})">💿 ${m.album}</button>` : ""}
        <div class="music-meta-row">
          ${dur ? `<span class="music-dur">⏱ ${dur}</span>` : ""}
          ${m.rank ? `<span class="music-dur">📊 ${fmt.number(m.rank)}</span>` : ""}
        </div>
      </div>
      <div class="music-right">
        <button class="fav-btn ${fav ? "active" : ""}" onclick="event.stopPropagation();onFavMusic(this,${mid})">❤</button>
        <div class="music-play-icon">▶</div>
      </div>
    </div>`;
}

function renderMusic(music) {
  const grid = document.getElementById("music");
  grid.innerHTML = music.length
    ? music.map((m, i) => buildMusicItem(m, i)).join("")
    : `<div class="state-msg"><span>🎵</span>Nessuna traccia trovata.</div>`;
}

function onFavMusic(btn, id) {
  btn.classList.toggle("active", toggleFav("music", dg(id)));
}

/* ─────────────────────────────────────────────
   MUSIC MODAL
   ───────────────────────────────────────────── */
async function openMusicModal(id) {
  const m = typeof id === "number" ? dg(id) : id;
  if (!m) return;

  const dur  = fmt.dur(m.duration);
  const mid  = ds(m);
  const aid  = ds({ id: m.artistId, name: m.artist });
  const alid = m.albumId ? ds({ id: m.albumId, title: m.album }) : null;

  document.getElementById("music-modal-header").innerHTML = `
    <div class="music-mh-inner">
      ${m.coverXL || m.coverBig
        ? `<img class="music-mh-cover" src="${m.coverXL || m.coverBig}" alt="${m.title}"/>`
        : `<div class="music-mh-cover music-mh-placeholder">🎵</div>`}
      <div class="music-mh-info">
        <div class="music-mh-title">${m.title}${m.explicit ? ` <span class="badge-explicit">E</span>` : ""}</div>
        <button class="artist-link-big" onclick="closeMusicModal();openArtistModal(${aid})">🎤 ${m.artist}</button>
        ${alid ? `<button class="album-link-big" onclick="closeMusicModal();openAlbumModal(${alid})">💿 ${m.album}</button>` : ""}
        <div class="music-mh-badges">
          ${dur ? `<span class="badge-meta">⏱ ${dur}</span>` : ""}
          ${m.rank ? `<span class="badge-meta">📊 Rank: ${fmt.number(m.rank)}</span>` : ""}
        </div>
        ${m.rank ? rankBar(m.rank) : ""}
        <div class="mh-fav-row">
          <button class="fav-btn-modal ${isFav("music", m) ? "active" : ""}" onclick="onFavMusicModal(this,${mid})">
            ${isFav("music", m) ? "❤️ Nei preferiti" : "🤍 Preferiti"}
          </button>
          <button class="concert-link-btn" onclick="closeMusicModal();searchConcertForArtist(${aid})">
            🎤 Vedi concerti
          </button>
        </div>
      </div>
    </div>`;

  buildAudioPlayer(m);
  document.getElementById("music-extra-stats").innerHTML =
    `<div class="stats-loading"><div class="video-spinner"></div><span>Caricamento statistiche…</span></div>`;
  document.getElementById("modal-music").classList.remove("hidden");
  document.body.style.overflow = "hidden";

  document.getElementById("video-loading").classList.remove("hidden");
  document.getElementById("yt-wrapper").classList.add("hidden");
  document.getElementById("yt-iframe").src = "";

  const [ytRes, lfRes] = await Promise.allSettled([
    fetch(`${API}/api/youtube-id?q=${encodeURIComponent(m.artist + " " + m.title + " official video")}`).then(r => r.json()),
    fetch(`${API}/api/track-info?artist=${encodeURIComponent(m.artist)}&title=${encodeURIComponent(m.title)}`).then(r => r.json()),
  ]);

  const videoId = ytRes.status === "fulfilled" ? ytRes.value?.videoId : null;
  if (videoId) {
    document.getElementById("yt-iframe").src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
    document.getElementById("video-loading").classList.add("hidden");
    document.getElementById("yt-wrapper").classList.remove("hidden");
  } else {
    document.getElementById("video-loading").innerHTML = `<span style="color:var(--text-3)">Video non disponibile.</span>`;
  }

  const lf = lfRes.status === "fulfilled" ? lfRes.value : {};
  renderTrackStats(lf, m);
}

function renderTrackStats(lf, m) {
  const el = document.getElementById("music-extra-stats");
  if (!el) return;

  const statsHTML = (lf.playcount || lf.listeners) ? `
    <div class="stats-grid">
      ${lf.playcount ? `<div class="stat-card"><div class="stat-num">${fmt.number(lf.playcount)}</div><div class="stat-label">▶ Scrobbles (Last.fm)</div></div>` : ""}
      ${lf.listeners ? `<div class="stat-card"><div class="stat-num">${fmt.number(lf.listeners)}</div><div class="stat-label">👂 Ascoltatori unici</div></div>` : ""}
      ${m.rank ? `<div class="stat-card"><div class="stat-num">${fmt.number(m.rank)}</div><div class="stat-label">📊 Rank Deezer</div></div>` : ""}
      ${m.duration ? `<div class="stat-card"><div class="stat-num">${fmt.dur(m.duration)}</div><div class="stat-label">⏱ Durata</div></div>` : ""}
    </div>` : `<div class="stat-card full-width">
      <div class="stat-label" style="font-style:italic;text-align:center;padding:10px 0">
        Aggiungi <strong>LASTFM_API_KEY</strong> nel .env per le statistiche
      </div></div>`;

  const tagsHTML = lf.tags?.length ? `
    <div class="stats-section">
      <div class="stats-section-title">Generi / Tag</div>
      <div class="tags-row">${lf.tags.map(t => `<span class="badge-genre">${t}</span>`).join("")}</div>
    </div>` : "";

  const wikiHTML = lf.wiki ? `
    <div class="stats-section">
      <div class="stats-section-title">📖 Info</div>
      <p class="wiki-text">${lf.wiki}</p>
    </div>` : "";

  const simHTML = lf.similar?.length ? `
    <div class="stats-section">
      <div class="stats-section-title">Brani simili</div>
      <div class="similar-tracks">
        ${lf.similar.map(s => {
          const sid = ds({ artist: s.artist, title: s.title });
          return `<div class="sim-track-chip" onclick="searchAndOpenTrack(${sid})">
            <span class="sim-track-title">${s.title}</span>
            <span class="sim-track-artist">${s.artist}</span>
          </div>`;
        }).join("")}
      </div>
    </div>` : "";

  el.innerHTML = `<div class="extra-stats-inner">${statsHTML}${tagsHTML}${wikiHTML}${simHTML}</div>`;
}

function buildAudioPlayer(m) {
  const el = document.getElementById("music-player-area");
  if (m.preview) {
    el.innerHTML = `
      <div class="preview-section">
        <div class="preview-label">ANTEPRIMA 30s · DEEZER</div>
        <div class="custom-player" id="custom-player">
          <button class="player-btn" id="play-pause-btn" onclick="togglePlay()">▶</button>
          <div class="player-progress-wrap" id="progress-wrap">
            <div class="player-bar-bg"><div class="player-bar-fill" id="player-fill"></div></div>
          </div>
          <span class="player-time" id="player-time">0:00 / 0:30</span>
        </div>
      </div>`;
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    currentAudio = new Audio(m.preview);
    currentAudio.addEventListener("timeupdate", updateProgress);
    currentAudio.addEventListener("ended", () => {
      const b = document.getElementById("play-pause-btn");
      if (b) b.textContent = "▶";
    });
    document.getElementById("progress-wrap").addEventListener("click", e => {
      if (!currentAudio) return;
      const r = e.currentTarget.getBoundingClientRect();
      currentAudio.currentTime = ((e.clientX - r.left) / r.width) * currentAudio.duration;
    });
    currentAudio.play().catch(() => {});
    const b = document.getElementById("play-pause-btn");
    if (b) b.textContent = "⏸";
  } else {
    el.innerHTML = `<p class="no-preview">Nessuna anteprima Deezer disponibile.</p>`;
  }
}

function togglePlay() {
  if (!currentAudio) return;
  const b = document.getElementById("play-pause-btn");
  if (currentAudio.paused) { currentAudio.play(); b.textContent = "⏸"; }
  else { currentAudio.pause(); b.textContent = "▶"; }
}

function updateProgress() {
  if (!currentAudio) return;
  const fill = document.getElementById("player-fill");
  const time = document.getElementById("player-time");
  const pct  = (currentAudio.currentTime / currentAudio.duration) * 100 || 0;
  if (fill) fill.style.width = pct + "%";
  if (time) {
    const c = Math.floor(currentAudio.currentTime);
    const t = Math.floor(currentAudio.duration) || 30;
    time.textContent = `${Math.floor(c/60)}:${(c%60).toString().padStart(2,"0")} / ${Math.floor(t/60)}:${(t%60).toString().padStart(2,"0")}`;
  }
}

function onFavMusicModal(btn, id) {
  const added = toggleFav("music", dg(id));
  btn.classList.toggle("active", added);
  btn.textContent = added ? "❤️ Nei preferiti" : "🤍 Preferiti";
}

function closeMusicModal(e) {
  if (e && e.target !== e.currentTarget) return;
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  document.getElementById("yt-iframe").src = "";
  document.getElementById("modal-music").classList.add("hidden");
  document.body.style.overflow = "";
}

/* ─────────────────────────────────────────────
   ARTIST MODAL
   ───────────────────────────────────────────── */
async function openArtistModal(id) {
  const info = dg(id); // { id, name }
  if (!info) return;

  document.getElementById("modal-artist-content").innerHTML = `
    <div class="artist-skeleton">
      <div class="artist-hero-placeholder"></div>
      <div class="modal-body">
        <p class="skeleton-line" style="width:45%"></p>
        ${["80%","60%","90%","70%"].map(w => `<p class="skeleton-line" style="width:${w}"></p>`).join("")}
      </div>
    </div>`;
  document.getElementById("modal-artist").classList.remove("hidden");
  document.body.style.overflow = "hidden";

  let deezer = null, lastfm = null;
  try {
    const res  = await fetch(`${API}/api/artist/${info.id}?name=${encodeURIComponent(info.name)}`);
    const data = await res.json();
    deezer = data.deezer; lastfm = data.lastfm;
  } catch {}

  document.getElementById("modal-artist-content").innerHTML = buildArtistHTML(deezer, lastfm, info.name);
}

function buildArtistHTML(d, lf, name) {
  const pic        = d?.picture || null;
  const artistName = d?.name || name;

  const statsHTML = `<div class="stats-grid">
    ${d?.fans    ? `<div class="stat-card"><div class="stat-num">${fmt.number(d.fans)}</div><div class="stat-label">❤️ Fan Deezer</div></div>` : ""}
    ${d?.nbAlbum ? `<div class="stat-card"><div class="stat-num">${d.nbAlbum}</div><div class="stat-label">💿 Album</div></div>` : ""}
    ${lf?.playcount ? `<div class="stat-card"><div class="stat-num">${fmt.number(lf.playcount)}</div><div class="stat-label">▶ Scrobbles</div></div>` : ""}
    ${lf?.listeners ? `<div class="stat-card"><div class="stat-num">${fmt.number(lf.listeners)}</div><div class="stat-label">👂 Ascoltatori</div></div>` : ""}
  </div>`;

  const tagsHTML = lf?.tags?.length ? `
    <div class="stats-section">
      <div class="stats-section-title">Generi</div>
      <div class="tags-row">${lf.tags.map(t => `<span class="badge-genre">${t}</span>`).join("")}</div>
    </div>` : "";

  const bioHTML = lf?.bio ? `
    <div class="stats-section">
      <div class="stats-section-title">📖 Biografia</div>
      <p class="wiki-text">${lf.bio}</p>
    </div>` : "";

  // Top brani Last.fm — cliccabili
  const topTracksHTML = lf?.topTracks?.length ? `
    <div class="stats-section">
      <div class="stats-section-title">🔥 Top Brani (Last.fm)</div>
      <div class="top-tracks-list">
        ${lf.topTracks.map((t, i) => {
          const tid = ds({ artist: artistName, title: t.title });
          return `<div class="top-track-row" onclick="searchAndOpenTrack(${tid})">
            <span class="top-track-pos">${i + 1}</span>
            <span class="top-track-title">${t.title}</span>
            ${t.playcount ? `<span class="top-track-plays">${fmt.number(t.playcount)} plays</span>` : ""}
            <span class="top-track-arrow">▶</span>
          </div>`;
        }).join("")}
      </div>
    </div>` : "";

  // Brani Deezer — chiudono artist modal, aprono music modal
  const deezerTopHTML = d?.topTracks?.length ? `
    <div class="stats-section">
      <div class="stats-section-title">🎵 Brani Popolari · Deezer</div>
      <div class="top-tracks-list" style="margin-top:8px">
        ${d.topTracks.map((m, i) => {
          const mid = ds(m);
          return `<div class="top-track-row" onclick="openTrackFromArtist(${mid})">
            <span class="top-track-pos">${i + 1}</span>
            ${m.cover ? `<img class="top-track-thumb" src="${m.cover}" alt="${m.title}"/>` : `<div class="top-track-thumb top-track-thumb-ph">🎵</div>`}
            <span class="top-track-title">${m.title}</span>
            ${m.duration ? `<span class="top-track-plays">${fmt.dur(m.duration)}</span>` : ""}
            <span class="top-track-arrow">▶</span>
          </div>`;
        }).join("")}
      </div>
    </div>` : "";

  // Album top Last.fm — cliccabili
  const topAlbumsHTML = lf?.topAlbums?.length ? `
    <div class="stats-section">
      <div class="stats-section-title">💿 Album più ascoltati</div>
      <div class="top-albums-row">
        ${lf.topAlbums.map(a => {
          const alid = ds({ artist: artistName, title: a.title });
          return `<div class="top-album-card" onclick="searchAlbumByName(${alid})">
            ${a.cover ? `<img src="${a.cover}" alt="${a.title}"/>` : `<div class="top-album-placeholder">💿</div>`}
            <div class="top-album-title">${a.title}</div>
            ${a.playcount ? `<div class="top-album-plays">${fmt.number(a.playcount)} plays</div>` : ""}
          </div>`;
        }).join("")}
      </div>
    </div>` : "";

  // Artisti simili — cliccabili
  const similarHTML = lf?.similar?.length ? `
    <div class="stats-section">
      <div class="stats-section-title">Artisti simili</div>
      <div class="similar-artists">
        ${lf.similar.map(a => {
          const sid = ds({ name: a.name });
          return `<span class="similar-artist-chip" onclick="openArtistByName(${sid})">${a.name}</span>`;
        }).join("")}
      </div>
    </div>` : "";

  const concAid = ds({ id: null, name: artistName });

  return `
    ${pic
      ? `<div class="artist-hero" style="background-image:url('${pic}')"><div class="artist-hero-fade"></div><div class="artist-hero-name">${artistName}</div></div>`
      : `<div class="artist-hero-text"><h2>${artistName}</h2></div>`}
    <div class="artist-modal-body">
      ${statsHTML}${tagsHTML}${bioHTML}
      <div class="artist-concerts-cta">
        <button class="btn-concerts" onclick="closeArtistModal();searchConcertForArtist(${concAid})">
          🎤 Vedi concerti di ${artistName}
        </button>
      </div>
      ${topTracksHTML}${deezerTopHTML}${topAlbumsHTML}${similarHTML}
    </div>`;
}

function closeArtistModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById("modal-artist").classList.add("hidden");
  document.body.style.overflow = "";
}

/* ─────────────────────────────────────────────
   ALBUM MODAL
   ───────────────────────────────────────────── */
async function openAlbumModal(id) {
  const info = dg(id); // { id, title } oppure { artist, title } da Last.fm
  if (!info) return;

  let albumId = info.id, albumTitle = info.title;

  // Se non abbiamo l'ID Deezer, lo cerchiamo tramite la ricerca
  if (!albumId && info.artist) {
    try {
      const data = await fetch(`${API}/api/music`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: `${info.artist} ${info.title}`, order: "RANKING" }),
      }).then(r => r.json());
      const track = data?.find(t => t.album?.toLowerCase().includes(info.title.toLowerCase())) || data?.[0];
      if (track?.albumId) { albumId = track.albumId; albumTitle = track.album || albumTitle; }
    } catch {}
  }

  document.getElementById("modal-album-content").innerHTML = `
    <div class="modal-body">
      <div class="modal-title-row"><h3>${albumTitle || "Album"}</h3></div>
      ${["60%","45%","80%","70%","55%"].map(w => `<p class="skeleton-line" style="width:${w}"></p>`).join("")}
    </div>`;
  document.getElementById("modal-album").classList.remove("hidden");
  document.body.style.overflow = "hidden";

  if (!albumId) {
    document.getElementById("modal-album-content").innerHTML =
      `<div class="modal-body"><div class="state-msg"><span>💿</span>Album non trovato su Deezer.</div></div>`;
    return;
  }

  let album = null;
  try { album = await fetch(`${API}/api/album/${albumId}`).then(r => r.json()); } catch {}

  if (!album) {
    document.getElementById("modal-album-content").innerHTML =
      `<div class="modal-body"><div class="state-msg"><span>💿</span>Album non trovato.</div></div>`;
    return;
  }

  const totalDur  = album.tracks?.reduce((acc, t) => acc + (t.duration || 0), 0);
  const genresHTML = (album.genres || []).map(g => `<span class="badge-genre">${g}</span>`).join("");
  const tracksHTML = album.tracks?.length ? `
    <div class="album-tracklist">
      ${album.tracks.map((t, i) => {
        const trackObj = { ...t, album: album.title, albumId: album.id, coverBig: album.cover, coverXL: album.cover };
        const tid = ds(trackObj);
        return `<div class="album-track" onclick="closeAlbumModal();setTimeout(()=>openMusicModal(${tid}),80)">
          <span class="track-num">${i + 1}</span>
          <span class="track-title">${t.title}${t.explicit ? ` <span class="badge-explicit">E</span>` : ""}</span>
          <span class="track-dur">${fmt.dur(t.duration) || ""}</span>
        </div>`;
      }).join("")}
    </div>` : "";

  document.getElementById("modal-album-content").innerHTML = `
    <div class="album-modal-inner">
      <div class="album-modal-left">
        ${album.cover ? `<img src="${album.cover}" alt="${album.title}"/>` : `<div class="album-cover-placeholder">💿</div>`}
        <div class="album-meta-block">
          ${album.artist    ? `<div class="crew-row"><span class="crew-label">🎤 Artista</span><span class="crew-value">${album.artist}</span></div>` : ""}
          ${album.releaseDate ? `<div class="crew-row"><span class="crew-label">📅 Uscita</span><span class="crew-value">${fmt.date(album.releaseDate)}</span></div>` : ""}
          ${album.nbTracks  ? `<div class="crew-row"><span class="crew-label">🎵 Tracce</span><span class="crew-value">${album.nbTracks}</span></div>` : ""}
          ${totalDur        ? `<div class="crew-row"><span class="crew-label">⏱ Durata tot.</span><span class="crew-value">${fmt.runtime(Math.floor(totalDur / 60))}</span></div>` : ""}
          ${album.label     ? `<div class="crew-row"><span class="crew-label">🏷️ Label</span><span class="crew-value">${album.label}</span></div>` : ""}
          ${album.fans      ? `<div class="crew-row"><span class="crew-label">❤️ Fan</span><span class="crew-value">${fmt.number(album.fans)}</span></div>` : ""}
        </div>
      </div>
      <div class="modal-body">
        <div class="modal-title-row">
          <h3>${album.title}</h3>
          ${album.releaseDate ? `<span class="modal-year">${fmt.year(album.releaseDate)}</span>` : ""}
        </div>
        ${genresHTML ? `<div class="modal-badges">${genresHTML}</div>` : ""}
        <div class="modal-section-title">Tracklist</div>
        ${tracksHTML}
      </div>
    </div>`;
}

function closeAlbumModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById("modal-album").classList.add("hidden");
  document.body.style.overflow = "";
}

/* ─────────────────────────────────────────────
   NAVIGATION HELPERS
   ───────────────────────────────────────────── */

// Brano Deezer dall'artist modal → chiude artist modal, apre music modal
function openTrackFromArtist(id) {
  closeArtistModal();
  setTimeout(() => openMusicModal(id), 80);
}

// Brano simile → cerca su Deezer, apre music modal
async function searchAndOpenTrack(id) {
  const s = dg(id); // { artist, title }
  closeMusicModal();
  closeArtistModal();
  try {
    const data = await fetch(`${API}/api/music`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: `${s.artist} ${s.title}`, order: "RANKING" }),
    }).then(r => r.json());
    if (data?.length) setTimeout(() => openMusicModal(ds(data[0])), 80);
  } catch {}
}

// Artista simile → cerca su Deezer, apre artist modal
async function openArtistByName(id) {
  const info = dg(id); // { name }
  closeArtistModal();
  try {
    const data = await fetch(`${API}/api/music`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: info.name, order: "RANKING" }),
    }).then(r => r.json());
    const track = data?.find(t => t.artist.toLowerCase() === info.name.toLowerCase()) || data?.[0];
    if (track) setTimeout(() => openArtistModal(ds({ id: track.artistId, name: track.artist })), 80);
  } catch {}
}

// Album top → cerca su Deezer, apre album modal
async function searchAlbumByName(id) {
  const info = dg(id); // { artist, title }
  closeArtistModal();
  try {
    const data = await fetch(`${API}/api/music`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: `${info.artist} ${info.title}`, order: "RANKING" }),
    }).then(r => r.json());
    const track = data?.find(t => t.album?.toLowerCase().includes(info.title.toLowerCase())) || data?.[0];
    if (track?.albumId) setTimeout(() => openAlbumModal(ds({ id: track.albumId, title: track.album })), 80);
  } catch {}
}

/* ─────────────────────────────────────────────
   CONCERTS
   ───────────────────────────────────────────── */
function searchConcertForArtist(id) {
  const info = dg(id); // { id, name }
  switchTab("music");
  setTimeout(() => {
    const s = document.getElementById("concerts-section");
    if (s) s.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 120);
  if (info?.name) document.getElementById("concert-artist-input").value = info.name;
  searchConcertsByArtist();
}

async function searchConcertsByArtist() {
  const artist   = document.getElementById("concert-artist-input").value.trim();
  if (!artist) return;
  const dateFrom = document.getElementById("ca-date-from")?.value || "";
  const dateTo   = document.getElementById("ca-date-to")?.value   || "";
  const country  = document.getElementById("ca-country")?.value   || "";
  const size     = document.getElementById("ca-size")?.value      || "20";

  const el      = document.getElementById("concerts-artist-results");
  const loading = document.getElementById("concerts-artist-loading");
  el.innerHTML = ""; loading.classList.remove("hidden");
  try {
    const params = new URLSearchParams({ artist, size });
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo)   params.set("dateTo",   dateTo);
    if (country)  params.set("country",  country);
    const data = await fetch(`${API}/api/concerts/artist?${params}`).then(r => r.json());
    loading.classList.add("hidden");
    renderConcertResults(el, data, `Nessun concerto trovato per <strong>${artist}</strong>.`);
  } catch {
    loading.classList.add("hidden");
    el.innerHTML = `<div class="state-msg"><span>⚠️</span>Errore nella ricerca.</div>`;
  }
}

async function searchConcertsByCity() {
  const city = document.getElementById("concert-city-input").value.trim();
  if (!city) return;
  const dateFrom = document.getElementById("cc-date-from")?.value || "";
  const dateTo   = document.getElementById("cc-date-to")?.value   || "";
  const country  = document.getElementById("cc-country")?.value   || "";
  const genre    = document.getElementById("cc-genre")?.value     || "Music";

  const el      = document.getElementById("concerts-city-results");
  const loading = document.getElementById("concerts-city-loading");
  el.innerHTML = ""; loading.classList.remove("hidden");
  try {
    const params = new URLSearchParams({ city, genre });
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo)   params.set("dateTo",   dateTo);
    if (country)  params.set("country",  country);
    const data = await fetch(`${API}/api/concerts/location?${params}`).then(r => r.json());
    loading.classList.add("hidden");
    renderConcertResults(el, data, `Nessun concerto trovato a <strong>${city}</strong>.`);
  } catch {
    loading.classList.add("hidden");
    el.innerHTML = `<div class="state-msg"><span>⚠️</span>Errore nella ricerca.</div>`;
  }
}

function renderConcertResults(el, data, emptyMsg) {
  if (!data.length) {
    el.innerHTML = `<div class="state-msg"><span>🎤</span>${emptyMsg}<br><small style="color:var(--text-3)">Prova a cambiare date o paese nei filtri.</small></div>`;
    return;
  }
  const grouped = {};
  data.forEach(e => {
    const key = e.date
      ? new Date(e.date).toLocaleDateString("it-IT", { month: "long", year: "numeric" })
      : "Data TBD";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(e);
  });
  el.innerHTML = Object.entries(grouped).map(([month, events]) => `
    <div class="concerts-month-group">
      <div class="concerts-month-label">${month} <span class="month-count">${events.length} eventi</span></div>
      <div class="concerts-list">${events.map(buildConcertCard).join("")}</div>
    </div>`).join("");
}

function buildConcertCard(e) {
  if (e.status === "info" && e.noKeyMessage) {
    return `<div class="concert-info-card">
      <div class="concert-info-icon">🔑</div>
      <div><p style="font-size:.88rem;color:var(--text-2);margin-bottom:8px">${e.noKeyMessage}</p>
      ${e.ticketUrl ? `<a class="btn-ticket" href="${e.ticketUrl}" target="_blank" rel="noopener">🔍 Ticketmaster</a>` : ""}</div>
    </div>`;
  }

  const date    = e.date ? new Date(e.date) : null;
  const isToday = date && date.toDateString() === new Date().toDateString();
  const isSoon  = date && (date - new Date()) < 7 * 86400000 && date > new Date();
  const timeStr = date ? date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "";
  const loc     = [e.venue, e.city, e.country].filter(Boolean).join(" · ");
  const nameStr = e.artistName || "";
  const lineup  = (e.lineup || []).filter(l => l && l !== nameStr).slice(0, 3);
  const price   = e.priceMin != null
    ? (e.priceMax && e.priceMax !== e.priceMin
        ? `${e.priceMin}–${e.priceMax} ${e.currency || "€"}`
        : `${e.priceMin} ${e.currency || "€"}`)
    : null;
  const genres  = (e.genres || []).filter(Boolean).join(" · ");
  const urgencyBadge   = isToday ? `<span class="concert-badge today">OGGI</span>`
                       : isSoon  ? `<span class="concert-badge soon">QUESTA SETTIMANA</span>` : "";
  const cancelledBadge = e.status === "cancelled" ? `<span class="concert-badge cancelled">CANCELLATO</span>` : "";
  const ticketBtn = e.ticketUrl || e.url
    ? `<a class="btn-ticket" href="${e.ticketUrl || e.url}" target="_blank" rel="noopener">🎟️ Biglietti</a>` : "";

  return `
    <div class="concert-card ${e.status === "cancelled" ? "cancelled" : ""}">
      ${e.artistImg ? `<img class="concert-img" src="${e.artistImg}" alt="${nameStr}" loading="lazy"/>` : ""}
      <div class="concert-date-col">
        ${date
          ? `<div class="concert-day">${date.getDate()}</div>
             <div class="concert-month">${date.toLocaleDateString("it-IT", { month: "short" }).toUpperCase()}</div>
             <div class="concert-year">${date.getFullYear()}</div>`
          : `<div class="concert-day-tbd">TBD</div>`}
      </div>
      <div class="concert-info">
        <div class="concert-name-row">
          ${nameStr ? `<div class="concert-artist-badge">${nameStr}</div>` : ""}
          ${urgencyBadge}${cancelledBadge}
        </div>
        <div class="concert-venue">📍 ${loc || "Venue TBD"}</div>
        ${timeStr  ? `<div class="concert-time">🕐 ${timeStr}</div>` : ""}
        ${genres   ? `<div class="concert-genres">${genres}</div>` : ""}
        ${price    ? `<div class="concert-price">💶 ${price}</div>` : ""}
        ${lineup.length ? `<div class="concert-lineup">
          <span class="lineup-label">Also:</span>
          ${lineup.map(l => `<span class="lineup-chip">${l}</span>`).join("")}
        </div>` : ""}
      </div>
      <div class="concert-actions">${ticketBtn}</div>
    </div>`;
}

/* ─────────────────────────────────────────────
   KEYBOARD + INIT
   ───────────────────────────────────────────── */
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeMovieModal();
    closeMusicModal();
    closeArtistModal();
    closeAlbumModal();
  }
});

window.addEventListener("load", () => {
  renderRecent("movies");
  renderRecent("music");
  searchMovies();
  loadCharts();
});
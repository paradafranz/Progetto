const API_KEY = process.env.TMDB_API_KEY || "3c028b9d5e2bb23d8bb0da82d31f518e";
const BASE    = "https://api.themoviedb.org/3";
const IMG     = "https://image.tmdb.org/t/p";

export async function getMovies({ query, genre, sortBy }) {
  try {
    let url = query
      ? `${BASE}/search/movie?api_key=${API_KEY}&language=it-IT&query=${encodeURIComponent(query)}`
      : `${BASE}/discover/movie?api_key=${API_KEY}&language=it-IT${genre ? `&with_genres=${genre}` : ""}${sortBy ? `&sort_by=${sortBy}` : ""}`;

    const res  = await fetch(url);
    const data = await res.json();
    if (!data.results) return [];

    let results = data.results;
    if (query && sortBy === "popularity.desc")
      results.sort((a, b) => b.popularity - a.popularity);
    else if (query && sortBy === "release_date.desc")
      results.sort((a, b) => new Date(b.release_date) - new Date(a.release_date));

    return results.map(m => ({
      id:       m.id,
      title:    m.title,
      overview: m.overview,
      poster:   m.poster_path ? `${IMG}/w500${m.poster_path}` : null,
      rating:   m.vote_average ? m.vote_average.toFixed(1) : null,
      year:     m.release_date ? m.release_date.split("-")[0] : null,
    }));
  } catch (err) {
    console.log("TMDB ERROR:", err.message);
    return [];
  }
}

export async function getMovieDetails(id) {
  try {
    // Fetch tutto in parallelo
    const [detRes, provRes, simRes] = await Promise.all([
      fetch(`${BASE}/movie/${id}?api_key=${API_KEY}&language=it-IT&append_to_response=credits`),
      fetch(`${BASE}/movie/${id}/watch/providers?api_key=${API_KEY}`),
      fetch(`${BASE}/movie/${id}/recommendations?api_key=${API_KEY}&language=it-IT&page=1`),
    ]);

    const [d, prov, sim] = await Promise.all([detRes.json(), provRes.json(), simRes.json()]);

    // Crew & cast
    const director  = d.credits?.crew?.find(p => p.job === "Director") || null;
    const writers   = (d.credits?.crew || []).filter(p => p.job === "Screenplay" || p.job === "Writer").slice(0, 2);
    const cast      = (d.credits?.cast || []).slice(0, 10);

    // Watch providers (IT prima, poi US come fallback)
    const region    = prov.results?.IT || prov.results?.US || {};
    const flatrate  = (region.flatrate || []).slice(0, 6);
    const rent      = (region.rent || []).slice(0, 4);
    const buy       = (region.buy  || []).slice(0, 4);

    // Film simili
    const similar   = (sim.results || []).slice(0, 6).map(m => ({
      id:     m.id,
      title:  m.title,
      poster: m.poster_path ? `${IMG}/w342${m.poster_path}` : null,
      rating: m.vote_average ? m.vote_average.toFixed(1) : null,
    }));

    return {
      id:          d.id,
      title:       d.title,
      originalTitle: d.original_title !== d.title ? d.original_title : null,
      tagline:     d.tagline || null,
      overview:    d.overview || "Nessuna descrizione disponibile.",
      poster:      d.poster_path   ? `${IMG}/w500${d.poster_path}`    : null,
      backdrop:    d.backdrop_path ? `${IMG}/w1280${d.backdrop_path}` : null,
      rating:      d.vote_average  ? d.vote_average.toFixed(1)        : null,
      voteCount:   d.vote_count    || 0,
      releaseDate: d.release_date  || null,
      runtime:     d.runtime       || null,
      status:      d.status        || null,
      budget:      d.budget        || null,
      revenue:     d.revenue       || null,
      genres:      (d.genres || []).map(g => g.name),
      director:    director ? director.name : null,
      writers:     writers.map(w => w.name),
      cast:        cast.map(c => ({
        id:        c.id,
        name:      c.name,
        character: c.character,
        photo:     c.profile_path ? `${IMG}/w185${c.profile_path}` : null,
      })),
      providers: { flatrate, rent, buy },
      similar,
    };
  } catch (err) {
    console.log("TMDB DETAILS ERROR:", err.message);
    return null;
  }
}
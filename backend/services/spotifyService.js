//NON UTILIZZATO
import axios from "axios";

const API_KEY = process.env.TMDB_KEY;

export async function getMovies(input) {
  try {
    let url;

    if (input.type === "title") {
      url = `https://api.themoviedb.org/3/search/movie`;
    } else {
      url = `https://api.themoviedb.org/3/movie/popular`;
    }

    const res = await axios.get(url, {
      params: {
        api_key: API_KEY,
        query: input.query,
        language: "it-IT"
      }
    });

    return (res.data.results || []).map(m => ({
      id: m.id,
      title: m.title,
      overview: m.overview,
      poster: m.poster_path
        ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
        : "https://via.placeholder.com/300x450"
    }));

  } catch (err) {
    console.log("TMDB ERROR:", err.message);
    return [];
  }
}
//NON UTILIZZATO
export function analyzeMood(text) {
  const t = text.toLowerCase();

  const isTitleSearch =
    t.includes("film") === false &&
    t.length > 3 &&
    !t.includes("sad") &&
    !t.includes("love") &&
    !t.includes("action");

  if (isTitleSearch) {
    return {
      type: "title",
      query: text
    };
  }

  if (t.includes("love") || t.includes("amore")) {
    return {
      type: "mood",
      genre: "romance"
    };
  }

  if (t.includes("sad") || t.includes("triste")) {
    return {
      type: "mood",
      genre: "drama"
    };
  }

  if (t.includes("action") || t.includes("azione")) {
    return {
      type: "mood",
      genre: "action"
    };
  }

  return {
    type: "mood",
    genre: "popular"
  };
}
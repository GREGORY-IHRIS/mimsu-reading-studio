// Splits long text into pieces of at most `max` characters, cutting at the
// most natural boundary available: a line break, then the end of a sentence,
// then a space. Never cuts inside an emotion tag such as "<short pause>".

const SENTENCE_END = /[.!?…。]["'”’)\]」』]*(?:\s+|$)/g;

function lastBoundary(window, regex, min) {
  let cut = null;
  for (const match of window.matchAll(regex)) {
    const end = match.index + match[0].length;
    if (end >= min && end <= window.length) cut = end;
  }
  return cut;
}

function findCut(text, max) {
  const window = text.slice(0, max);
  const min = Math.floor(max / 2);

  // A boundary right after the window also counts (the character at `max` is
  // whitespace), so look one character further for the space test.
  let cut =
    lastBoundary(window, /\n+/g, min) ??
    lastBoundary(window, SENTENCE_END, min) ??
    lastBoundary(text.slice(0, max + 1), /\s+/g, min) ??
    max;

  const open = text.lastIndexOf("<", cut - 1);
  const close = text.lastIndexOf(">", cut - 1);
  if (open > close && open > 0) cut = open;
  return cut;
}

export function splitText(text, max) {
  const pieces = [];
  let rest = text.trim();
  while (rest.length > max) {
    const cut = findCut(rest, max);
    const piece = rest.slice(0, cut).trim();
    if (piece) pieces.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

const SESSION_STATE = new WeakMap();
const DRAW_METHODS = new Set(["manual", "starlight"]);

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function optionalIdentityText(value) {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function normalizedWords(value) {
  const text = optionalIdentityText(value);
  if (!text) return "";

  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[._:/\\()[\]{}\u2010-\u2015-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function prosePoemVariant(card) {
  const name = normalizedWords(card.name);
  const id = normalizedWords(card.id);
  const rank = normalizedWords(card.rank);
  const suit = normalizedWords(card.suit);
  const identityFields = [name, id].filter(Boolean);

  const hierophantMatch = identityFields
    .map((value) => value.match(/(?:^|\s)(?:the\s+)?hierophant\s+([ab])$/))
    .find(Boolean);
  if (hierophantMatch || (/^v\s+[ab]$/.test(rank) && suit === "major arcana")) {
    return {
      canonicalKey: "the-hierophant",
      variant: hierophantMatch?.[1] ?? rank.at(-1),
    };
  }

  const swordsMatch = identityFields
    .map((value) => value.match(/(?:^|\s)(?:10|ten)\s+of\s+swords\s+([ab])$/))
    .find(Boolean);
  if (swordsMatch || (/^10\s+[ab]$/.test(rank) && suit === "swords")) {
    return {
      canonicalKey: "ten-of-swords",
      variant: swordsMatch?.[1] ?? rank.at(-1),
    };
  }

  return null;
}

function stableCardId(deckKey, card, index) {
  const explicitId = optionalIdentityText(card.id);
  if (explicitId) return explicitId;

  const fallback = optionalIdentityText(card.file) ?? optionalIdentityText(card.name);
  if (!fallback) {
    throw new TypeError(
      `cards[${index}] needs a non-empty id, file, or name so its selection can be identified.`,
    );
  }

  return `${deckKey}:${fallback}`;
}

function randomUnit(random) {
  const value = random();
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("random() must return a finite number from 0 (inclusive) to 1 (exclusive).");
  }

  return value;
}

function sessionState(session) {
  if (!session || typeof session !== "object") {
    throw new TypeError("session must be a draw session object.");
  }

  const state = SESSION_STATE.get(session);
  if (!state) {
    throw new TypeError("session was not created by createDrawSession().");
  }

  return state;
}

/**
 * Creates a single-card draw session without depending on DOM or rendering state.
 * `order` contains indices into the supplied `cards` array.
 */
export function createDrawSession({
  deckKey,
  cards,
  method = "manual",
  question = "",
  random = Math.random,
} = {}) {
  const normalizedDeckKey = requiredText(deckKey, "deckKey");

  if (!Array.isArray(cards)) {
    throw new TypeError("cards must be an array.");
  }
  if (cards.length === 0) {
    throw new RangeError("cards must contain at least one card.");
  }
  if (!DRAW_METHODS.has(method)) {
    throw new RangeError('method must be either "manual" or "starlight".');
  }
  if (typeof question !== "string") {
    throw new TypeError("question must be a string.");
  }
  if (typeof random !== "function") {
    throw new TypeError("random must be a function.");
  }

  const isProsePoem = normalizedDeckKey.toLowerCase() === "prosepoem";
  const ids = new Set();
  const groups = new Map();
  const cardsByIndex = new Map();

  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    if (!card || typeof card !== "object" || Array.isArray(card)) {
      throw new TypeError(`cards[${index}] must be a card object.`);
    }

    const id = stableCardId(normalizedDeckKey, card, index);
    if (ids.has(id)) {
      throw new RangeError(`cards contains the duplicate stable id "${id}".`);
    }
    ids.add(id);

    const variant = isProsePoem ? prosePoemVariant(card) : null;
    const canonicalId = variant
      ? `${normalizedDeckKey}:${variant.canonicalKey}`
      : id;
    const metadata = { index, id, canonicalId, variant: variant?.variant ?? null };
    cardsByIndex.set(index, metadata);

    const group = groups.get(canonicalId);
    if (group) {
      group.push(metadata);
    } else {
      groups.set(canonicalId, [metadata]);
    }
  }

  const order = [];
  for (const group of groups.values()) {
    const choice = group.length === 1
      ? group[0]
      : group[Math.floor(randomUnit(random) * group.length)];
    order.push(choice.index);
  }

  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(randomUnit(random) * (index + 1));
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }

  const session = {
    deckKey: normalizedDeckKey,
    method,
    question,
    phase: "setup",
    order,
    selectedIndex: null,
    selectedId: null,
  };

  SESSION_STATE.set(session, {
    cardsByIndex,
    selectedPosition: null,
  });

  return session;
}

/** Selects one shuffled position and locks the session to that card. */
export function pickDrawCard(session, position) {
  const state = sessionState(session);

  if (session.phase !== "selecting") {
    throw new Error('Cards can only be selected while session.phase is "selecting".');
  }
  if (state.selectedPosition !== null || session.selectedIndex !== null || session.selectedId !== null) {
    throw new Error("This draw session already has a selected card.");
  }
  if (!Number.isInteger(position)) {
    throw new TypeError("position must be an integer.");
  }
  if (position < 0 || position >= session.order.length) {
    throw new RangeError("position is outside the shuffled draw order.");
  }

  const index = session.order[position];
  const card = state.cardsByIndex.get(index);
  if (!card) {
    throw new RangeError("The selected position does not point to a valid catalog index.");
  }

  state.selectedPosition = position;
  session.selectedIndex = index;
  session.selectedId = card.id;
  session.canonicalId = card.canonicalId;
  session.phase = "revealing";

  return index;
}

/** Selects the first card in the already-shuffled draw order. */
export function autoPickDrawCard(session) {
  return pickDrawCard(session, 0);
}

/** Marks a revealed draw complete. Completing an already-complete draw is harmless. */
export function markDrawRevealed(session) {
  sessionState(session);

  if (session.phase === "complete") return session;
  if (session.phase !== "revealing") {
    throw new Error('A draw can only be completed while session.phase is "revealing".');
  }

  session.phase = "complete";
  return session;
}

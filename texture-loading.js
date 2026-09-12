/** Keep logical material keys stable while allowing verified lossless encodings. */
export function getTextureUrl(deck, name, original = false) {
  const file = original ? name : deck.textureVariants?.[name] ?? name;
  const url = new URL(file, deck.textureRoot);
  if (deck.textureVersion) url.searchParams.set("v", deck.textureVersion);
  return url.href;
}

export function createDeckTexturePlan(decks) {
  return Object.entries(decks).flatMap(([deckKey, deck]) => {
    const preview = new Set([deck.selectorCover, ...Object.values(deck.selector3D?.faces ?? {})].filter(Boolean));
    const required = new Set(deck.textureFiles ?? []);
    // The shared book model binds upright inner faces; retain the source files on disk.
    const unused = new Set(deck.model === "book" ? ["inner-front.jpg", "inner-back.jpg"].filter((name) => required.has(name.replace(".jpg", "-upright.jpg"))) : []);
    return [...new Set([...required, ...preview])].filter((name) => !unused.has(name)).map((name) => ({
      key: `${deckKey}:${name}`, deckKey, name, preview: preview.has(name),
      path: getTextureUrl(deck, name), fallbackPath: getTextureUrl(deck, name, true),
    }));
  });
}

/** Deduplicate concurrent requests; preserve partial success and retry only failures. */
export function createDeckTextureCache(entries, loadTexture) {
  const textures = Object.create(null);
  const promises = new Map();
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  function ensureOne(key) {
    if (textures[key]) return Promise.resolve(textures[key]);
    if (promises.has(key)) return promises.get(key);
    const entry = byKey.get(key);
    if (!entry) return Promise.reject(new RangeError(`Unknown material: ${key}`));
    const request = Promise.resolve().then(() => loadTexture(entry.path, entry.fallbackPath))
      .then((texture) => {
        if (!texture) throw new Error(`Material unavailable: ${key}`);
        textures[key] = texture;
        return texture;
      }).finally(() => promises.delete(key));
    promises.set(key, request);
    return request;
  }
  return {
    textures,
    preloadPreviews: () => Promise.allSettled(entries.filter((entry) => entry.preview).map((entry) => ensureOne(entry.key))),
    ensureDeck: (deckKey) => {
      const selected = entries.filter((entry) => entry.deckKey === deckKey);
      if (!selected.length) return Promise.reject(new RangeError(`Unknown deck: ${deckKey}`));
      return Promise.all(selected.map((entry) => ensureOne(entry.key)));
    },
  };
}

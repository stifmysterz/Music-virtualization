/* Shared LRU index for regular 3D backgrounds and VJ scenes. */
function createSceneCacheIndex(limit) {
  const lastUsed = Object.create(null);
  let clock = 0;

  function touch(kind) {
    lastUsed[kind] = ++clock;
  }

  function forget(kind) {
    delete lastUsed[kind];
  }

  function evictionCandidates(kinds, activeKind) {
    const overflow = Math.max(0, kinds.length - limit);
    if (!overflow) return [];
    return kinds
      .filter(kind => kind !== activeKind)
      .sort((a, b) => (lastUsed[a] || 0) - (lastUsed[b] || 0))
      .slice(0, overflow);
  }

  return { limit, lastUsed, touch, forget, evictionCandidates };
}

const bg3DSceneCacheIndex = createSceneCacheIndex(8);
const BG3D_SCENE_CACHE_LIMIT = bg3DSceneCacheIndex.limit;
const bg3DSceneLastUsed = bg3DSceneCacheIndex.lastUsed;

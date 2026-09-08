/* Shared machine-readable loop contract for every registered VJ tunnel. */
function createVjLoopMeta(kinds, premiumMeta, wrapDistance) {
  return Object.freeze(Object.fromEntries(kinds.map(kind => [kind, Object.freeze({
    loopBeats: premiumMeta[kind]?.loopBeats || 16,
    wrapDistance,
    seamlessStrategy: 'deterministic-depth-wrap',
    deterministicRecycle: true,
    qualityTier: premiumMeta[kind] ? 'premium' : 'standard'
  })])));
}

const VJ_LOOP_META = createVjLoopMeta(VJ_TUNNEL_KINDS, VJ_PREMIUM_META, VJ_LEN);

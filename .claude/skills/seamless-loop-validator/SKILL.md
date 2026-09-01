---
name: seamless-loop-validator
description: Validate and fix seamless VJ and animation loops. Use when checking loop boundaries, frame continuity, camera continuity, procedural noise, particles, transforms, BPM timing, animation phase, or visible resets.
---

# Seamless Loop Validator

## MISSION

Make animation loops repeat continuously without visible seams. A viewer watching
the loop for minutes should never be able to point at the moment it restarted.

## PROJECT CONTEXT

Loops run inside `61.html` on the shared Three.js r149 engine. VJ tunnels are the
`vj*` keys in `VJ_TUNNEL_KINDS`, built by `buildBg3DVj*` functions, updated through
`renderBg3D(bass, mid, high, dt)`. Audio bands are `lastBass` / `lastMid` /
`lastHigh` / `beat`. Any per-effect state lives on the scene object in
`bg3DScenes[kind]`. There is no build step — edit the function in place.

## STATE TO CHECK AT THE LOOP BOUNDARY

Compare the very first frame of the loop against the frame immediately after the
last, for every one of these:

- Camera position
- Camera rotation
- Camera target / lookAt
- Geometry position
- Geometry rotation
- Geometry scale
- Morph / vertex-displacement state
- Material parameters (emissive intensity, opacity, roughness, uniforms, offsets)
- Lighting (intensity, color, position of moving lights)
- Bloom (strength, radius, threshold if animated)
- Color / palette / hue drift
- Particles (positions, ages, velocities, spawn cursor)
- Noise sample coordinates / phase
- Procedural deformation phase
- Audio-reactive state (any smoothed value carried frame to frame)
- BPM phase
- Post-processing uniforms
- Global intensity / energy accumulators
- Velocity of every animated quantity above

## SEAM TEST

Diff first-loop state vs final-loop state. Flag any of:

- Position mismatch
- Rotation mismatch
- Scale mismatch
- Camera jump
- Lighting jump
- Color jump
- Particle pop (mass respawn, sudden appearance/disappearance)
- Noise discontinuity
- Material reset
- Sudden intensity change

## MOTION CONTINUITY

Do not only compare positions. Also inspect **velocity and acceleration** across the
boundary.

Avoid:

- Sudden acceleration
- Sudden deceleration
- Direction changes at the seam
- Camera snapping
- Particle mass respawn

Prefer periodic functions — `sin()`, `cos()`, and other functions that are
continuous in value *and* derivative across the period. A quantity built as
`A * sin(2π * phase * k)` (integer `k`) returns to its start value and its start
slope automatically.

Put the camera on a **closed path** (e.g. a `CatmullRomCurve3` with `closed: true`,
sampled at `t = phase`) so position and heading wrap for free.

## PROCEDURAL NOISE

Do **not** create a new random seed when the loop restarts. Do not reseed particle
arrays on wrap.

Use a loop-compatible noise phase: sample noise on a circle in its input domain, so
`noise(cos(2π·phase)·r, sin(2π·phase)·r)` is exactly periodic. Keep all
`Math.random()` calls in the builder (one-time setup), never in the per-frame
update.

## BPM

Determine, in order:

1. BPM — from `bpmIn` if set, else the volume-guessed `beat`
2. Beats per loop — one of 4 / 8 / 16 / 32
3. Normalized phase:

   ```js
   phase = (elapsedBeats % loopBeats) / loopBeats;   // 0..1
   ```

4. Exact return to the initial phase — confirm `phase` hits 0 again and every
   animated value is written purely as a function of `phase` (plus smoothed audio),
   with no free-running accumulators that drift.

## ACCEPTANCE

The viewer should **NOT** be able to tell when the loop restarted.

If the viewer thinks *"it just restarted"* — the loop **FAILS**. Fix the largest
discontinuity, re-run the seam test, repeat until clean.

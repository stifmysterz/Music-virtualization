---
name: premium-vj-loop
description: Create and upgrade premium cinematic VJ loops for the Music Visualizer. Use when creating, redesigning, or improving VJ loop visuals, especially high-detail 3D motion graphics, EDM visuals, DJ backgrounds, seamless loops, camera choreography, materials, lighting, audio reactivity, and post-processing.
---

# Premium VJ Loop

## MISSION

Create VJ loops that feel like professional commercial motion graphics and premium
DJ/VJ visuals.

The target is **NOT** a basic WebGL demo.

Target:

- Premium
- Cinematic
- Detailed
- Sophisticated
- Smooth
- Designed
- VJ-ready

The VJ Loop layer is the **reference quality standard** for this whole project. The
2D visualizer and the 3D background are held to the same bar.

## WHERE THIS LIVES IN THE CODE

Single file: `61.html` (~25,400 lines, no build step, no bundler).

- Three.js **r149** is bundled inline (with `EffectComposer`, `RenderPass`,
  `UnrealBloomPass`, `ShaderPass`). Do not add a second copy, do not upgrade it
  without explicit approval.
- VJ tunnels are registered in `VJ_TUNNEL_KINDS` (array of `vj*` keys) and built by
  `BG3D_BUILDERS` entries named `buildBg3DVj<Name>`. They deliberately stay **out**
  of `BG3D_CATALOG` but share the same engine as the 3D backgrounds.
- `buildVjMenu()` generates the VJ menu from `VJ_TUNNEL_KINDS`.
- `enableBg3D(kind)` mounts a scene; each scene object is `bg3DScenes[kind]` and may
  carry its own `.composer` (EffectComposer + UnrealBloomPass).
- `renderBg3D(bass, mid, high, dt)` drives per-frame updates; audio comes from
  `lastBass` / `lastMid` / `lastHigh` / `beat`, produced by `detectBeat()` and
  `computeMidHigh()` off the shared `analyser`.
- Camera behaviour is themed through `bg3DCameraMotion`.

Follow the existing effect lifecycle: an `init`/builder that creates scene objects,
an `update` step called every frame, and a `dispose` that frees geometry, materials,
textures and render targets. Never leak. Never modify code outside the target
effect without a stated technical reason.

## NON-NEGOTIABLE

Never ship VJ loops that look like:

- Basic WebGL demos
- Rotating cubes
- Simple primitive tunnels
- Generic particles
- Flat gradients
- Cheap neon lines
- Low-poly placeholders
- One object rotating forever
- Random procedural noise
- Programmer-demo aesthetics

DO NOT create a VJ loop whose entire concept is effectively:

```
rotate()
scale()
particles++
repeat
```

That is not sufficient.

## VISUAL CONSTRUCTION

Use meaningful combinations of the following. A premium loop draws from several of
these categories at once — a single technique in isolation reads as a demo.

### GEOMETRY
- Intricate procedural geometry
- Curves
- Tubes (`TubeGeometry` along `CatmullRomCurve3` paths)
- Organic forms
- Fractals
- Dense structures
- Morphing geometry (animated vertex / morph targets / shader displacement)
- Layered geometry (foreground / midground / background passes)
- Surface detail (normal / roughness variation, bevels, greebles, panel lines)

### MATERIALS
- Chrome
- Liquid metal
- Glass
- Holographic
- Iridescent
- Reflective (env map / `MeshStandardMaterial` with `metalness` + `envMap`)
- Translucent
- Emissive (drives bloom — key it to audio, not left constant)
- Fresnel (rim falloff via custom shader or `onBeforeCompile`)
- Refraction
- Controlled roughness (never a single flat value across the whole scene)

### LIGHTING
- Key lights
- Rim lights
- Specular highlights
- Light sweeps (moving light or animated emissive band)
- Reflections
- Shadows (only where they add depth and the frame budget allows)
- Atmospheric lighting
- Volumetric-looking effects (fake god-rays, additive cones, depth-faded planes)
- Controlled bloom (`UnrealBloomPass` — tuned threshold/strength/radius, not maxed)

### ATMOSPHERE
- Fog (`scene.fog` / exponential fog for depth grading)
- Haze
- Dust
- Floating particles (parallax layers at different depths and sizes)
- Light rays
- Depth layers
- Atmospheric perspective (distant elements desaturate / lose contrast)

### CAMERA

Use designed cinematic movement:

- Dolly
- Orbit
- Banking (roll into turns)
- Smooth zoom
- Parallax
- Depth transitions
- Curved paths (camera on a closed spline for seamless return)
- Easing (no linear starts/stops)

Avoid lazy constant rotation.

### MOTION

Design a visual story, even in a short loop:

```
Build → Development → Peak → Release → Return
```

The "Return" must land exactly on the "Build" state so the loop is seamless (see
the `seamless-loop-validator` skill).

## AUDIO

Use different audio bands intelligently. Read from `lastBass`, `lastMid`,
`lastHigh`, `beat`. Always smooth the reaction (lerp toward target, ~0.1–0.2 per
frame; never assign raw analyser values straight to transforms).

- **Bass** — geometry deformation, camera pulse, scale, energy, impact hits
- **Mid** — secondary movement, material parameter shifts, rotation drift
- **High** — fine particles, sparks, shimmer, emissive flicker, grain
- **Overall energy** — global intensity, lighting level, bloom strength, atmosphere
  density

Prefer audio-driven motion over `Math.random()` wandering.

## BPM

Support loop lengths of **4 / 8 / 16 / 32 beats**. Use a normalized phase and
deterministic timing:

```js
phase = (elapsedBeats % loopBeats) / loopBeats;   // 0..1, returns to 0 exactly
```

Drive periodic motion from `phase` through `sin` / `cos` so the state at `phase = 1`
equals the state at `phase = 0`. If no BPM is set (`bpmIn` empty), fall back to the
volume-guessed `beat` but keep the loop period defined by wall-clock time, not by
beat detection.

## POST-PROCESSING

Use where it genuinely improves the frame:

- Bloom
- Distortion
- Chromatic aberration
- Film grain
- Vignette
- Color grading
- Motion blur approximation
- Depth effects

**Never use post-processing to hide poor geometry.** If the frame only looks good
with bloom at maximum, the geometry and lighting underneath are not finished.

## QUALITY GATE

Before approving a VJ loop, check every item:

1. Premium appearance
2. Sufficient detail
3. Visual hierarchy (a clear focal point, not uniform noise)
4. Cinematic camera
5. Strong materials
6. Lighting depth
7. Musical audio reaction
8. Seamless looping
9. Performance (stable 60 FPS target on capable hardware, ≥30 FPS on low-end;
   do not raise particle count or resolution without approval)
10. Professional LED-wall suitability

If any major category fails: **KEEP IMPROVING.**

Quality is more important than effect count. A smaller set of flawless loops beats a
large set of rough ones.

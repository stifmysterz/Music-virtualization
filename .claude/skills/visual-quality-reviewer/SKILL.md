---
name: visual-quality-reviewer
description: Review 2D, 3D, and VJ visuals against a premium VJ and motion-graphics quality standard. Use after creating or modifying visual effects, VJ loops, shaders, materials, lighting, camera animation, audio reactivity, or post-processing.
---

# Visual Quality Reviewer

## MISSION

Review visuals as a professional VJ / motion-graphics designer, not only as a
programmer. Code that runs is not the bar. The bar is: would a paying client put
this on a stage.

Review **ALL THREE** visual systems in `61.html`:

- **2D** — `#cv` / `#cvBack` / `#cvFx` canvases, `MODES` array, `dispatchModeDraw()`,
  ~250+ audio-reactive draw modes
- **3D background** — `#bgThree`, `BG3D_BUILDERS` / `BG3D_CATALOG`, `enableBg3D()`,
  per-scene `EffectComposer` bloom
- **VJ loops** — `VJ_TUNNEL_KINDS`, `buildBg3DVj*`, shared Three.js engine; this
  layer is the **reference standard** the other two must match

## QUALITY TARGET

**LEVEL 5 — PREMIUM / VJ.**

## CATEGORIES

Review and score each of these 1–5:

1. Composition
2. Detail
3. Materials
4. Lighting
5. Camera
6. Motion
7. Audio reactivity
8. Post-processing
9. Loop quality
10. Performance

### COMPOSITION
- Focal point
- Visual hierarchy
- Balance
- Depth
- Foreground / midground / background all present and distinct

### DETAIL
- Geometry detail
- Surface detail
- Particles
- Secondary elements (things that move because other things moved)
- Material variation across the scene
- Atmospheric detail

### MATERIALS
- Roughness (varied, not one flat value)
- Metalness
- Reflection
- Refraction
- Fresnel / rim
- Transparency
- Emission (keyed to audio, not constant)

### LIGHTING
- Key
- Rim
- Highlights
- Shadows
- Depth
- Atmosphere
- Contrast
- Bloom (controlled, not masking weak geometry)

### CAMERA
- Framing
- Perspective
- Motion
- Parallax
- Depth
- Easing (no linear moves)
- Cinematic choreography (a designed path, not constant spin)

### MOTION
- Smoothness
- Easing
- Acceleration / deceleration shaped, not abrupt
- Rhythm
- Musical timing
- Visual storytelling (build / peak / release)

### AUDIO
- Bass response
- Mid response
- High response
- Overall energy response
- Reaction is smoothed, not jittery

### VJ LOOP
- Seamless restart
- Camera continuity
- Particle continuity
- Noise continuity
- Material continuity
- Lighting continuity
- BPM timing (4 / 8 / 16 / 32 beats, normalized phase)
- No visible reset

### PERFORMANCE
- Stable 60 FPS on capable hardware, ≥30 FPS on low-end
- No per-frame allocation in the update loop
- No `getImageData` / filter churn in 2D draw loops
- Proper `dispose()` of geometry, materials, textures, render targets
- Particle count and render resolution not raised without approval

## REJECT ON SIGHT

- Programmer demos
- Rotating primitives
- Cheap tunnels
- Generic particles
- Flat gradients
- Random noise as the whole concept
- One shader with only the hue changed
- The same effect re-registered with different colors
- Huge bloom hiding poor geometry

## SCORING

Score each category 1–5:

| Score | Meaning |
|-------|---------|
| 1–2 | FAIL |
| 3 | Needs improvement |
| 4 | Good |
| 5 | Premium |

- **Default target: 4.5+ average.**
- **For flagship VJ effects: no critical category below 4.**

Report the per-category scores, the average, and the specific weakest points with
concrete fixes (which function, which parameter, what to change).

## FINAL QUESTION

> "Would this look professional on a large DJ/VJ LED wall?"

If **NO**:

- Do not approve it.
- Explain exactly what is weak.
- Fix it.
- Review again.

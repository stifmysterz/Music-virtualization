# CLAUDE.md — Premium Music Visualizer / 2D / 3D / VJ Loop Engineering Rules

## 0. Mission

Build and maintain a **professional-grade Music Visualizer** whose visual quality is comparable to premium VJ / motion-graphics content, not a basic WebGL demo.

The project has THREE first-class visual systems:

1. **2D Visualizer**
2. **3D Visualizer / Background**
3. **Premium VJ Loops**

All three systems share the same visual-quality bar.

> **Quality > Quantity**
>
> **Visual Design > Technical Novelty**
>
> **Detail > Cheap Complexity**
>
> **Smooth Motion > Random Motion**
>
> **Seamless Loop > Animation Reset**

The VJ Loop quality target is the visual reference standard for the whole project.

---

# 1. Core Quality Standard

Every new visual effect must aim for:

- Premium motion-graphics quality
- Professional VJ / EDM / DJ visual quality
- High visual density without visual clutter
- Fine surface/detail work
- Sophisticated lighting
- Controlled composition
- Cinematic depth
- Smooth animation
- Deliberate camera movement
- High-quality post-processing
- Audio/BPM responsiveness where appropriate
- Strong beginning/middle/end visual choreography
- Seamless looping when the effect is designed as a loop

Do NOT optimize for simply producing more effects.

A small number of excellent effects is preferable to a large number of repetitive effects.

---

# 2. ABSOLUTE NO-CHEAP-VISUAL RULE

Do NOT create effects that look like:

- Basic WebGL tutorials
- Simple rotating cubes/spheres
- Primitive geometry with one material
- Flat gradients pretending to be 3D
- Low-detail particle clouds
- Generic starfields
- One-layer neon lines
- Simple tunnel + camera-forward animation
- Random noise without artistic composition
- Repeated scale/rotate/translate with no visual design
- Default Three.js demo aesthetics
- Placeholder graphics presented as finished work
- Extremely low-poly geometry unless intentionally stylized
- Cheap bloom used to hide lack of detail
- Excessive glow with no material definition
- Random camera shaking
- Random color cycling
- Abrupt animation resets
- Visible loop seams

If an effect looks like a coding experiment rather than finished motion graphics, it is NOT DONE.

---

# 3. 2D VISUALIZER SYSTEM

The 2D system must also reach premium VJ-quality.

## 3.1 2D Visual Design

Use advanced combinations of:

- Procedural graphics
- Shader-based effects
- Multi-layer compositing
- Particle systems
- Fluid-like motion
- Distortion
- Feedback
- Trails
- Energy fields
- Organic deformation
- Kaleidoscopic structures
- Light streaks
- Atmospheric layers
- Depth simulation
- Masking
- Blend modes
- Motion blur
- Bloom/glow
- Chromatic effects
- Controlled noise
- Audio-reactive deformation

Avoid making every effect look like a conventional audio spectrum.

The waveform/spectrum should be treated as one component of a larger composition.

## 3.2 2D Layering

Prefer multiple visual layers such as:

BACKGROUND
→ ATMOSPHERE
→ PRIMARY FORM
→ SECONDARY DETAILS
→ PARTICLES / ENERGY
→ AUDIO REACTIVE ELEMENTS
→ LIGHT / GLOW
→ POST-PROCESSING

Each layer should have a visual purpose.

---

# 4. 3D VISUALIZER SYSTEM

The existing **61+ 3D effects** must be treated as a quality library, not merely a count.

Do not reduce or remove existing effects unless explicitly requested.

When improving existing effects:

- Preserve their public behavior/API where possible
- Improve geometry quality
- Improve materials
- Improve lighting
- Improve camera choreography
- Improve depth
- Improve animation curves
- Improve audio response
- Improve post-processing
- Improve loop behavior
- Improve performance

## 4.1 Premium 3D Materials

Use materials intentionally:

- Chrome
- Brushed metal
- Glass
- Frosted glass
- Liquid
- Gel
- Holographic
- Iridescent
- Translucent
- Ceramic
- Dark reflective surfaces
- Emissive materials
- Procedural surfaces

Use Fresnel, reflection, refraction, roughness, metalness and environment lighting where appropriate.

Do not make every object emissive/neon.

---

# 5. PREMIUM VJ LOOP SYSTEM

VJ Loops are a separate first-class system.

A VJ Loop is NOT simply a 3D effect with a timer.

It should behave like a professionally designed motion-graphics/VJ asset.

## 5.1 VJ LOOP VISUAL TARGET

Target:

**Premium VJ / Motion Graphics / Commercial Stock Footage quality**

The visual language should be suitable for:

- DJ sets
- EDM
- Clubs
- Festivals
- Live performance
- Music videos
- LED walls
- Projection
- Stage visuals
- Premium visualizer backgrounds

## 5.2 VJ LOOP DETAIL REQUIREMENTS

VJ Loops should favor:

- High-detail procedural geometry
- Complex surfaces
- Fine micro-details
- Sophisticated material response
- Layered lighting
- Reflections
- Refractions
- Fresnel effects
- Volumetric lighting
- Atmospheric haze
- Depth fog
- Particle accents
- Fine surface displacement
- Organic deformation
- Morphing
- Controlled distortion
- Cinematic depth
- Strong composition

The scene should feel designed, not randomly generated.

## 5.3 VJ LOOP MATERIAL QUALITY

Preferred material combinations:

- Chrome + dark environment
- Glass + volumetric light
- Liquid + refraction
- Holographic + iridescence
- Metallic + cinematic reflections
- Translucent organic surfaces
- Emissive energy + physical surfaces
- Layered transparent geometry

Use subtle imperfections and material variation where it improves realism.

Avoid plastic-looking default materials.

---

# 6. VJ LOOP CAMERA CHOREOGRAPHY

Camera motion must be intentionally designed.

Do NOT rely on:

```js
camera.position.z += 0.1;
```

as the primary visual movement.

Use combinations of:

- Cinematic dolly
- Orbit
- Banking
- Parallax
- Controlled zoom
- Depth transitions
- Focus shifts
- Smooth orbital paths
- Curved camera paths
- Controlled acceleration/deceleration
- Subtle perspective changes

Camera motion should have musical phrasing.

Avoid random shaking unless explicitly designed as an effect.

---

# 7. VJ LOOP ANIMATION DESIGN

Animation should contain visual choreography.

Example structure:

INTRO
→ BUILD
→ TRANSFORMATION
→ PEAK
→ RELEASE
→ RETURN TO START STATE

Or:

FORMATION
→ MORPH
→ ENERGY PULSE
→ CAMERA TRANSITION
→ DETAIL REVEAL
→ MORPH BACK

Do not make every loop simply rotate continuously.

Use:

- Ease-in/out
- Spring-like motion where appropriate
- Smooth spline interpolation
- Procedural deformation
- Morph targets
- Noise-driven micro-motion
- Layered frequencies
- Slow macro motion + fast micro detail

---

# 8. SEAMLESS LOOP REQUIREMENTS

Every VJ Loop must be mathematically or procedurally loopable.

Preferred loop lengths:

- 4 beats
- 8 beats
- 16 beats
- 32 beats

Default target:

**8 or 16 beats**

For a loop of duration T:

The visual state at time 0 must match the state at time T.

Avoid:

- Position drift
- Rotation accumulation
- Unbounded noise
- Random state changes
- Particle state mismatch
- Camera discontinuity
- Lighting discontinuity
- Audio envelope discontinuity

Use periodic functions, deterministic seeds, phase wrapping, or explicit state restoration.

---

# 9. AUDIO / BPM REACTIVITY

Audio-reactive behavior must feel musical, not chaotic.

Use:

- Bass
- Mid
- High
- Overall energy
- Beat detection
- BPM
- Onset detection
- Smoothed envelopes

Prefer:

```text
RAW AUDIO
→ NORMALIZATION
→ SMOOTHING
→ ENVELOPE
→ MAPPING
→ VISUAL RESPONSE
```

Avoid directly mapping raw FFT values to every property.

Different frequency bands should drive different visual dimensions.

Example:

BASS
→ scale / deformation / camera pulse

MID
→ geometry movement / particles

HIGH
→ highlights / fine particles / light streaks

MASTER ENERGY
→ global intensity / composition

---

# 10. POST-PROCESSING

Post-processing is part of the visual design, not an afterthought.

Use where appropriate:

- Bloom
- Tone mapping
- Color grading
- Vignette
- Chromatic aberration
- Film grain
- Motion blur
- Depth of field
- Screen-space distortion
- Feedback
- Glitch
- Lens effects
- Volumetric effects

Do not stack every effect blindly.

Post-processing must improve the image.

The final image should retain:

- Detail
- Contrast
- Depth
- Material definition
- Visual hierarchy

Avoid the "everything is glowing" look.

---

# 11. LOOP QUALITY GATE

Before declaring a VJ Loop complete, perform ALL checks.

## A. Visual Quality

- [ ] Does it look premium?
- [ ] Does it have sufficient detail?
- [ ] Does the geometry feel intentional?
- [ ] Do materials look designed?
- [ ] Is lighting sophisticated?
- [ ] Is there depth?
- [ ] Is the composition strong?
- [ ] Does it look like finished motion graphics rather than a coding demo?

## B. Motion Quality

- [ ] Is motion smooth?
- [ ] Are animation curves intentional?
- [ ] Is camera motion cinematic?
- [ ] Is there macro + micro motion?
- [ ] Does the visual choreography have progression?

## C. Loop Quality

- [ ] Is the first frame compatible with the final frame?
- [ ] Is there no visible jump?
- [ ] Is there no reset feeling?
- [ ] Is there no accumulated drift?
- [ ] Can it repeat indefinitely?

## D. Audio Quality

- [ ] Does BPM sync feel musical?
- [ ] Are reactions smoothed?
- [ ] Are bass/mid/high responses differentiated?
- [ ] Is audio reactivity controlled rather than chaotic?

## E. Performance

- [ ] No unnecessary render loops
- [ ] No uncontrolled object creation
- [ ] No memory leaks
- [ ] No runaway particle count
- [ ] GPU workload is reasonable
- [ ] Effect remains usable in the target browser/device

If any major item fails, do not call the effect finished.

---

# 12. 2D / 3D / VJ SHARED QUALITY GATE

Every visual system must pass:

```text
VISUAL QUALITY
      ↓
DETAIL QUALITY
      ↓
MOTION QUALITY
      ↓
AUDIO REACTIVITY
      ↓
POST-PROCESSING
      ↓
LOOP QUALITY
      ↓
PERFORMANCE
```

The same quality standard applies to:

- 2D
- 3D
- VJ Loops

VJ Loops are the visual-quality reference, not the only premium system.

---

# 13. 30 FPS / 60 FPS

Do NOT hard-code a 30 FPS assumption into the visual engine.

Animation must be time-based.

Use elapsed time / delta time rather than frame-count-dependent animation.

Target:

- 60 FPS when hardware allows
- Graceful performance at 30 FPS
- Consistent animation speed across frame rates

Never make animation depend on:

```js
x += 0.1;
```

without delta-time normalization.

---

# 14. PERFORMANCE ENGINEERING

Before adding complexity:

1. Profile
2. Identify bottleneck
3. Optimize
4. Re-test

Avoid premature simplification that destroys visual quality.

Use:

- Object pooling
- Instancing
- Buffer reuse
- Texture reuse
- Shader efficiency
- Controlled particle counts
- Lazy initialization
- Resource disposal
- Proper resize handling

Never trade major visual quality for tiny code convenience.

---

# 15. LOOP VALIDATION TOOLING

When possible, create development/debug modes for:

- Loop start/end preview
- Seam comparison
- Difference visualization
- BPM simulation
- Beat markers
- Audio envelope visualization
- FPS display
- GPU/render statistics
- Effect quality/debug controls

A developer should be able to inspect:

```text
LOOP START
     ↓
FULL LOOP PLAYBACK
     ↓
LOOP END
     ↓
START/END COMPARISON
     ↓
PASS / FAIL
```

---

# 16. PLAN MODE

Before major changes:

1. Inspect the current architecture.
2. Identify existing visual systems.
3. Identify reusable components.
4. Check for regressions.
5. Plan changes.
6. Implement incrementally.
7. Validate visually and technically.

Do not rewrite working systems unnecessarily.

When adding a new VJ Loop, first determine whether existing:

- shaders
- materials
- post-processing
- particle systems
- camera utilities
- audio analysis
- loop utilities

can be reused.

---

# 17. BUG CHECKING

After significant changes:

- Check console errors
- Check shader compilation
- Check WebGL errors
- Check resize behavior
- Check audio initialization
- Check memory growth
- Check FPS
- Check effect switching
- Check loop restart
- Check rapid switching between effects
- Check browser reload
- Check fullscreen
- Check different aspect ratios

Do not assume that "it renders" means it is finished.

---

# 18. GIT BACKUP

Before major architectural changes:

1. Check git status.
2. Create a meaningful checkpoint/commit.
3. Make the changes.
4. Validate.
5. Keep the repository recoverable.

Never destroy working visual systems during experimentation.

---

# 19. DEVELOPMENT STRATEGY

When adding many effects, work in controlled batches.

Recommended:

```text
Batch 1
→ Build 10 high-quality effects

Validate
→ Visual + Loop + Performance

Batch 2
→ Build next 10

Validate

Batch 3
→ Build next 10
```

Do NOT generate dozens of low-quality effects just to increase the effect count.

---

# 20. EFFECT NAMING

Effect names should describe visual intent.

Good:

- Chrome Helix
- Liquid Fractal Tunnel
- Holographic Bloom
- Glass Wave Chamber
- Neon Particle Cathedral
- Organic Energy Tunnel
- Iridescent Morph Field
- Volumetric Light Maze

Bad:

- Effect1
- Test3D
- NewEffect
- CoolThing
- RandomTunnel

---

# 21. VISUAL DIVERSITY

Do not make 30 effects that are variations of the same tunnel.

Create different visual families:

- Organic
- Mechanical
- Liquid
- Glass
- Metallic
- Cosmic
- Architectural
- Fractal
- Energy
- Particle
- Atmospheric
- Abstract
- Holographic
- Optical
- Experimental

Each family should have a distinct visual identity.

---

# 22. FINAL DEFINITION OF DONE

An effect is DONE only when:

1. It works technically.
2. It looks visually intentional.
3. It has sufficient detail.
4. It has professional motion.
5. It responds appropriately to audio where applicable.
6. It integrates with post-processing.
7. It performs acceptably.
8. It does not break other effects.
9. Its loop is seamless if designed as a loop.
10. It passes the Premium Visual Quality Gate.

The goal is not:

> "Make a WebGL effect that works."

The goal is:

> **"Create a polished, premium visual asset that could plausibly be used in a professional DJ/VJ performance."**

---

# 23. PRIORITY ORDER

When requirements conflict, prioritize:

1. Visual quality
2. Smooth motion
3. Seamless looping
4. Audio synchronization
5. Composition
6. Material / lighting quality
7. Performance
8. Code elegance
9. Effect quantity

Never sacrifice the visual result merely to make the implementation shorter.

---

# 24. GOLDEN RULE

**DO NOT LOWER THE QUALITY BAR JUST BECAUSE THE EFFECT IS PROCEDURAL.**

Procedural does NOT mean:

- crude
- repetitive
- low-detail
- random
- primitive

Procedural systems should be used to create:

- complex detail
- rich motion
- sophisticated variation
- repeatable loops
- high visual density
- premium VJ aesthetics

Every visual should feel **designed, polished, intentional and performance-ready**.

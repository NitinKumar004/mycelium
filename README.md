# Mycelium

**A living art toy that runs in your web browser.**

The screen fills with up to **a million tiny glowing "agents"** — think microscopic organisms.
Each one follows just **three simple rules**: leave a glowing trail behind it, sniff the trails
nearby, and steer toward the strongest scent. Nobody animates them. From those three rules, the
agents **organize themselves into branching, vein-like networks** that look genuinely alive and
never stop evolving — like slime mold, blood vessels, or lightning.

It's based on a real scientific model of **slime mold** (*Physarum polycephalum*), the organism
famous for growing efficient transport networks (it once recreated the Tokyo rail map on its own).

### What you can do

- **Turn dials** to change how the agents behave → completely different patterns (webs, spirals,
  mazes, glowing clouds). Every control has a plain-language description built into the app (the
  **"? Explain"** button).
- **Pick presets** — *Coral, Cyclone, Nervous System, Nebula, Maze…* — and **Morph** between them.
- **Pan / zoom** around, or **drop an image** so the network grows into its shape.
- **Save a PNG or video**, or **Copy link** — the entire state lives in the URL, so a link
  recreates the exact pattern on someone else's screen.

### Why it's technically interesting

Every agent runs on your **graphics card (GPU)** — that's how a *million* particles move smoothly
at 60fps. It's a single static web page: **no backend, no database, no API keys.** WebGPU where
available (Chrome/Edge), with a WebGL2 fallback (Safari 17+, Firefox).

> In one line: a generative-art instrument — tweak a few knobs and watch a million particles
> paint an ever-changing living structure you can share.

![placeholder — drop a captured GIF here](docs/mycelium.gif)

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # -> dist/, deploy anywhere static
```

Chrome/Edge use the **WebGPU** path (compute shaders in WGSL). Safari 17+ and
Firefox fall back to **WebGL2** (texture ping-pong, GLSL ES 3.00). Force one with
`?backend=webgpu` / `?backend=webgl2`. Add `?debug=1` for the per-frame overlay.

## The algorithm (Jones 2010)

Every simulation frame runs four passes, in this exact order:

1. **Sense + Steer + Move.** Each agent samples the trail field at three points —
   left, center, right of its heading — weights each sample by the species
   interaction matrix, and turns toward the strongest. When *both* sides beat the
   center it turns a **random** direction; that one branch is what breaks symmetry
   into organic asymmetry instead of a sterile lattice. Then it steps forward and
   wraps on a torus.
2. **Deposit.** Each agent adds chemical into its species' channel of the trail
   field (additive blending).
3. **Diffuse + Decay.** A 3×3 blur spreads the field; a per-step multiply (exposed
   in the UI as a **half-life in seconds**) fades it.
4. **Render + Post.** Trail channels → per-species emission colors → HDR → bloom →
   tonemap (AgX/ACES) → grade → grain + vignette + chromatic aberration → sRGB.

The **species interaction matrix** (§ the 4×4 grid in the panel) is the most
expressive control: symmetric-positive gives classic networks, antisymmetric gives
chasing spirals, negative-diagonal gives self-avoiding mazes.

> Reference: Jones 2010, *"Characteristics of pattern formation and evolution in
> approximations of Physarum transport networks."*

## Architecture

```
src/
  core/        Store (reactive params), Loop (fixed timestep), params (metadata), capability
  sim/         Simulation interface + WebGPUSimulation + WebGL2Simulation
  shaders/     wgsl/ and glsl/ — shared math in common.* included by every pass
  render/      Camera (momentum pan/zoom), palette
  ui/          Panel, Slider (scrubbable), SpeciesMatrix (drag-to-set), styles, textmask
  state/       serialize (URL hash), morph (preset cross-fade), recorder (WebM)
  presets/     ten hand-tuned presets
```

Design rules that keep it honest:

- **Zero per-agent work on the CPU.** Agents live only in GPU memory; the CPU
  never touches an agent array after the GPU seed.
- **One `Params` object with metadata.** The UI generates itself from
  `PARAM_META`. Adding a slider means editing one file.
- **One `Simulation` interface, two backends.** The app never knows which is live.
- **Shared shader math** lives in `common.wgsl` / `common.glsl`, kept parallel so
  the two paths don't drift.
- **Fixed 1/60s timestep** with an accumulator — structure is reproducible
  regardless of display refresh.

## Controls

- **Drag** to pan, **scroll** to zoom (torus wraps at the edges).
- **Tab** hides/shows the panel. **R** reseeds. **Space** pauses. **P** exports PNG.
- Every slider is click-drag-scrubbable anywhere on the row; **Shift** for fine,
  the number is directly editable, arrow keys nudge.
- Drop an image on the seed control to grow the network into its shape.
- **Copy link** puts the entire state in the URL. **Morph 6s** cross-fades to a
  preset. **Record** captures WebM/VP9.

## What's fully built vs. known-lean

Complete: both backends, the full four-pass simulation with emergent structure,
HDR + bloom + AgX/ACES + grade + grain/vignette/aberration, the instrument UI with
live params and the species-matrix control, ten presets, URL-hash state, preset
morphing, PNG export, WebM recording, image-mask seeding, the adaptive
render-scale controller, the title sequence, keyboard nav, and reduced-motion.

Known-lean (documented honestly rather than faked):

- **WebGL2 bloom** is a two-pass separable-Gaussian approximation of the WebGPU
  path's 5-mip dual-Kawase pyramid. Close, not pixel-identical.
- **WebGL2 orientation** is vertically mirrored relative to WebGPU (GL vs. WebGPU
  texture origin). Each path is internally correct; the simulation is a torus.
- **PNG super-resolution** (up-to-4× tiled) is implemented on the WebGPU path;
  WebGL2 exports at canvas resolution.
- **Cursor trail-brush**, **IndexedDB user presets**, **timestamp-query profiling**,
  and **audio reactivity** are scaffolded in the interface but not wired.

## License

MIT.

# SynRecordia

[![Progress](https://img.shields.io/badge/Progress-60%25-yellow?style=flat-square)](#)

<p align="center">
  <img src="demo/preview.gif" alt="Visualizer preview" />
</p>

<p align="center">
  You can view the SynRecordia live <a href="https://synrecordia.netlify.app/">demo</a> online.
</p>

SynRecordia is an interactive browser-based piano/recorder visualizer and sampler built with React. Inspired by [![](https://cdn.synthesia.app/images/headerIcon.png)Synthesia](https://synthesiagame.com/), it focuses on presenting clear note visualizations alongside sampled audio playback so you can see fingering while listening. The app runs fully in the browser using Tone.js for audio and PIXI.js for visuals.


<p align="center">
  <a href="https://reactjs.org/"><img src="https://img.shields.io/badge/React-18.x-blue?logo=react&logoColor=white" alt="React" /></a>
  <a href="https://tonejs.github.io/"><img src="https://img.shields.io/badge/Tone.js-15.x-9cf?logo=tonal&logoColor=white" alt="Tone.js" /></a>
  <a href="https://pixijs.com/"><img src="https://img.shields.io/badge/PIXI.js-8.x-ff66cc?logo=pixijs&logoColor=white" alt="PIXI.js" /></a>
</p>

Core ideas
- Visual learning + listening: timeline with fingering graphics and note labels.
- Sampled instruments: load instrument sample sets and switch variants.
- Lightweight, web-first: client-side playback, visualization, and instrument configuration.

Accomplished
- Note Visualization (prepared)
  - Timeline visualizer that draws per-note fingering graphics and labels.
  - Smooth scrolling and beat interpolation to follow playback without snapping.
  - Visual highlights (glow/particles) for active notes.
  - Implemented in `src/components/Visualizer.jsx`.

- Real-time Interactions
  - Play / Pause / Restart controls and tempo (BPM) control per song.
  - Mouse/touch scrubbing and wheel-to-scrub support.
  - Repeat/loop playback and per-track selection for instrument control.
  - Playback scheduling using `Tone.js` to trigger sampled notes in real-time.
  - Implemented in `src/components/Player.jsx`.

- Instrument Configuration
  - Per-instrument controller UI (volume, variant/version selection).
  - Packed sampler abstraction in `src/libs/packedSampler/` with instrument-specific implementations (`piano.js`, `recorder.js`).
  - Samples and versions hosted under `public/samples/<instrument>/<version>/index.json`.

Planned / Goals
- Read and load MIDI files in the browser
  - Let users import standard MIDI files and convert them to the internal song format (tracks/actions).

- Play Mode / Interactive Scoring
  - Real-time play mode that reads user input from a MIDI keyboard (Web MIDI API) or from microphone pitch detection and scores performance vs. the song.
  - Provide hit/miss feedback and a scoring summary to support practice sessions.

Quick Start

1. Install dependencies (from project root):
```bash
npm install
```

2. Start development server:
```bash
npm run dev
```

3. Build for production:
```bash
npm run build
```

Samples & attribution
- Salamander Grand Piano V2 — Alexander Holm. Licensed CC BY 3.0. http://creativecommons.org/licenses/by/3.0/
- Philharmonia samples — sourced from Philharmonia (https://philharmonia.co.uk/resources/sound-samples/). These samples are free to use but MUST NOT be redistributed "as-is" from this repository. Please download them from the official site and place them locally into `public/samples/...` as described in SAMPLES.md.

Installing recorder (flute) samples
- Obtain the samples:
  1. Visit the Philharmonia samples page: https://philharmonia.co.uk/resources/sound-samples/
  2. Download the woodwind / flute pack from that site (follow their instructions and licensing).
- Prepare the sample zip:
  1. Inside the downloaded pack find (or create) `flute.zip` that contains the flute audio files.
  2. Copy `flute.zip` into this project's recorder samples folder:
     - Place the zip at `public/samples/recorder/flute.zip`
     - Example (from project root):
       - `cp /path/to/downloaded/flute.zip public/samples/recorder/`
- Run the organizer script:
  1. From the project root execute:
     - `node scripts/prepare-recorder.mjs`
  2. The script will:
     - Extract `flute.zip` to a temporary location.
     - Keep only files whose filename contains an underscore-delimited numeric index equal to 1 (for example: `flute_A4_1_mezzo-forte_normal.mp3`). Files with other numeric indices or without the index will be discarded.
     - Detect dynamics from the filename and move kept files into dynamic folders under `public/samples/recorder/`:
       - `forte`, `mezzo-forte`, `mezzo-piano`, `pianissimo`, `piano`
     - Example resulting path: `public/samples/recorder/mezzo-forte/flute_A4_1_mezzo-forte_normal.mp3`

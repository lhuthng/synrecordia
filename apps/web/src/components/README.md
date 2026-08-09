# components/

React components for the SynRecordia UI, organized by responsibility.

## Directory layout

```
components/
  ui/               # Design-system atoms
  layout/           # Page-level shells and decoration
  modals/           # Overlay dialogs
  player/           # Playback bar and instrument management
  Details.jsx       # Song metadata panel (app-level singleton)
  Directory.jsx     # Song browser/listing (app-level singleton)
  EcoModeToast.jsx  # Eco-mode notification toast
  Visualizer.jsx    # PIXI canvas wrapper (app-level singleton)
```

## ui/

Stateless design-system primitives. No audio logic, no canvas references.
Components accept only props — no context reads, no side effects.

| File | Role |
|------|------|
| `DuoButton.jsx` | Two-state button (active / inactive) |
| `DuoSelect.jsx` | Styled select with a paired label |
| `DuoSlideBar.jsx` | Labeled range slider |
| `DuoToggleButton.jsx` | Icon-based on/off toggle |
| `SettingTooltip.jsx` | Tooltip wrapper for control labels |

## layout/

Page-level shells and purely presentational decoration.

| File | Role |
|------|------|
| `Header.jsx` | Top navigation bar |
| `AmbientLight.jsx` | CSS-driven ambient glow overlay |
| `SynthwaveBackground.jsx` | Animated background canvas/SVG |

## modals/

Overlay dialogs rendered via a React Portal, sitting above the normal tree.

| File | Role |
|------|------|
| `AdvancedSettingsModal.jsx` | Playback and audio settings |
| `SelectDeviceModal.jsx` | MIDI / audio device picker |

## player/

Everything rendered inside the playback bar.

| File | Role |
|------|------|
| `Player.jsx` | Full playback bar — orchestrates all player sub-components |
| `CompactPlayer.jsx` | Stripped-down variant used on the `/compact` route |
| `SongTimeline.jsx` | Scrub bar with zoom and position indicator |
| `InstrumentManager.jsx` | Per-track sampler lifecycle; renders instrument panels |

`InstrumentManager` bridges the audio engine and the UI: it instantiates and
tears down samplers as tracks change and delegates each instrument's control
panel to the component exported by that instrument's `index.js`.

## Root-level files

App-level singletons that do not belong to a specific subcategory:

- **`Visualizer.jsx`** — mounts and owns the PIXI application; passes the canvas ref to the active `BaseVisualizerInstrument`.
- **`Details.jsx`** — displays song title, composer, and metadata.
- **`Directory.jsx`** — renders the song list / file browser.
- **`EcoModeToast.jsx`** — notifies the user that eco mode has been activated.
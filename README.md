# Matopeli — Snake II in Rust + WebAssembly

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/engine-Rust-orange.svg)](engine/)
[![WebAssembly](https://img.shields.io/badge/runs-WebAssembly-blue.svg)](public/engine.wasm)
[![No dependencies](https://img.shields.io/badge/offline-yes-green.svg)](#run-it)

Nokia 3310 tribute. The whole game runs on a 26&nbsp;KB dependency-free
WASM module — no CDN, no fonts, no images, no backend.

![Gameplay](docs/shot-gameplay.png)

| Start screen | Game over | Mobile — game first |
|---|---|---|
| ![Start](docs/shot-start.png) | ![Game over](docs/shot-gameover.png) | ![Mobile](docs/shot-mobile.png) |

## How to play

| Keys | Does what |
|---|---|
| <kbd>2</kbd> <kbd>4</kbd> <kbd>6</kbd> <kbd>8</kbd> | Steer — like the real Nokia |
| <kbd>1</kbd>–<kbd>9</kbd> | Pick start level |
| <kbd>Start</kbd> / Navi / <kbd>Enter</kbd> | Start, confirm |
| <kbd>C</kbd> / <kbd>Space</kbd> | Pause |
| Arrows / WASD / swipe | Also steer |

Eat **5** foods to clear each of the **9 mazes**. The bonus bug pays
**20 + time left** but vanishes fast. Walls and your own tail kill.
Best score stays in the browser.

## Run it

```sh
npm install
npm run dev        # dev server
npm run build && npm run preview   # production, still fully offline
```

## How it works

```text
engine/src/lib.rs  →  Rust game logic (grid, mazes, bonus, scoring)
        │  cargo build --target wasm32-unknown-unknown (26 KB, zero deps)
        ▼
public/engine.wasm →  loaded by src/scripts/snake.ts (render + input + beeps)
        │
        ▼
src/pages/index.astro + Tailwind  →  the 3310 around it
```

```sh
cd engine
cargo test                                  # 6 logic tests
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/engine.wasm ../public/engine.wasm
```

## License

MIT — see [LICENSE](LICENSE).

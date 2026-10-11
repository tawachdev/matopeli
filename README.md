# Matopeli — Snake II in Rust + WebAssembly

Nokia 3310 tribute. Game logic is pure Rust compiled to a 26 KB
dependency-free WASM module (`engine/`). Shell is Astro + Tailwind
(shadcn-style components, no React runtime). No CDN, no fonts, no
images, no backend — works fully offline.

License: MIT — see [LICENSE](LICENSE).

## Play (no internet needed)
```sh
npm run dev       # dev server
npm run build && npm run preview   # production
```

## Controls
Phone keypad **2/4/6/8** steer, **1–9** pick start level, **C** pauses,
Navi/Start confirms. Arrows/WASD, swipe and Enter work too.

## Rules
9 mazes, 5 foods per level, speed 160ms → 70ms, bonus bug with
countdown, walls + tail kill, best score in the browser.

## Hack on it
```sh
cd engine
cargo test                                  # 6 logic tests
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/engine.wasm ../public/engine.wasm
```

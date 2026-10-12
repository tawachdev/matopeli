# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
People who remember the Nokia 3310 and want to hold one again in the browser, on a phone or a desktop: play Snake II, poke through the phone menu, and send real SMS between two browsers.

## Product Purpose
Matopeli is a playable Nokia 3310 in the browser. Success is that it feels like picking up the real phone: the same face, the same keys, the same menus, and Snake II running on a dependency-free Rust/WASM engine.

## Positioning
Not a Snake clone with a phone picture around it: the whole device works. Boot, idle screen, menu, apps and real SMS run behind the same keypad, and the game is one app on the phone.

## Capabilities and Constraints
- Phone OS: boot, idle, main menu (Messages, Call register, Tones, Settings, Games, Calculator, Reminders, Names).
- Games: Snake II (Rust engine compiled to WASM) and Pairs II.
- Real SMS through a Cloudflare Worker (D1 + Durable Object); without it the phone shows NO SIGNAL and the rest works offline.
- Installable PWA that works offline; no CDN, no web fonts, no images beyond icons.
- Keyboard and touch must both drive everything; element ids used by the game, OS and tests are part of the contract.

## Brand Commitments
- The face is a classic Nokia 3310 (confirmed 2026-10-12): Navi key, C key, scroll keys, 3x4 keypad, green LCD.
- The phone fills the whole screen on every device; no backdrop around it (confirmed 2026-10-12).

## Evidence on Hand
README screenshots in `docs/`. No testimonials, user numbers, or press exist; do not invent them.

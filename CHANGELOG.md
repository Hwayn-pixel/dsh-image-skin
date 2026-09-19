# Changelog

## 0.1.0 — 2026-09-13

First public release.

The plugin started as a private project: a host half (settings namespace + local upload/storage/serve
routes) and a browser half (region painting, draggable stickers, settings submenu). This release
hardens it for public use, with an offline test suite for the host half.

### Added

- `POST /dsh-image-skin/gc` — collects stored files that no area references any more. Called
  automatically after every image change and exposed as **清理未使用图片** in the settings page.
  The keep set is computed on the host from the resolved settings, and a 60-second cooldown protects
  a file that was just uploaded but not committed to settings yet.
- Streaming upload cap (`MAX_UPLOAD_BYTES`, 32 MB request body) answering `413` while the body is
  still arriving, plus a matching 24 MB pre-check and a visible error message in the settings page.
- **Per-mode artwork.** Every area gained `<area>ImageLight` / `<area>ImageDark` next to the shared
  `<area>Image`; resolution is mode-specific first, shared as the fallback, so a config written before
  this change keeps working. A sun/moon slider — registered in `sidebar.footer.action` (beside
  Settings) and mirrored in the settings page — writes the real DSH theme preference through the
  `theme` service, and follows `theme/change` when the theme is switched elsewhere.
- **Video playback rate.** `videoPlaybackRate` drives `playbackRate` / `defaultPlaybackRate` on the
  window video and on sticker videos. Sticker areas now render a `<video>` for video URLs instead of
  an `<img>` that silently showed nothing.
- `test/` suite — 48 assertions in two offline files: `host.test.mjs` (upload round-trip, byte
  fidelity, both oversize paths, unsupported type, malformed payload, path traversal, GC keep /
  collect / fresh-file / per-mode-only semantics, `409` on unresolved settings, idempotent delete,
  route disposer) and `client-units.test.mjs` (per-mode image resolution, evaluated from the built
  bundle with a stub React — no DOM, no browser). No DSH process, no network.
- Explicit `kind: "prefix"` on the route registration, and the `register()` disposer is now returned
  to `ctx.effect`, so unloading the plugin actually removes the routes.

### Fixed

- **Region images disappeared after the UI re-rendered.** Repainting only happened on settings or
  theme changes, so regions whose host mounts later (welcome hero, right panel) never received their
  image. A throttled repair pass now repaints whatever is missing, without touching stickers.
- **`panelOpacity` at 0 blanked the interface to white.** The video wallpaper inherited the slider's
  alpha and faded to `opacity: 0` while the panels went transparent, leaving the browser's white
  canvas exposed; static images were unaffected because they ride on `body`'s `background-image`.
  The wallpaper is now always full-strength.
- **The sidebar stayed opaque.** `--dsw-specific-sidebar-fill` (a documented theme token: "Sidebar
  column and title-row background") was not overridden, so the sidebar kept an opaque fill however
  low the slider went.
- **Disabling the plugin left visible residue.** Teardown now also removes the window backdrop, the
  video layer, sticker elements, the `position: relative` added to sticker hosts and the injected
  styles.
- **Silent upload failures.** Non-OK responses were only logged to the console; the reason is now
  shown in the settings page.
- Removed the one-off DOM probe (`POST /dsh-image-skin/probe` and its client helper) and the panel
  opacity debounce timer is cleared on unmount.

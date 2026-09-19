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
- **Per-mode artwork.** The settings page became two levels: two large **浅色模式 / 深色模式** buttons at
  the top of the plugin page open one identical image menu per mode, so each scheme has its own set of
  images. Entering a mode also switches the live theme, so what you configure is what you see. Every
  area gained `<area>ImageLight` / `<area>ImageDark` next to the shared `<area>Image`; resolution is
  mode-specific first, shared as the fallback, so a config written before this change keeps working.
  A sun/moon switch lives in `sidebar.footer.action` (beside Settings, sized to match it), writes the
  DSH theme preference through `setTheme`, and follows `theme/change` when the theme is switched
  elsewhere.
- **Smooth light/dark switch.** A theme flip used to snap in one frame. Now the plugin opens a short
  transition window (`body[data-dsh-skin-theme-anim]`, 320 ms) in which `background-color`, `color` and
  `border-color` transition, so DSH's palette and the plugin's own tint cross-fade. When the wallpaper
  differs per mode and both sides are still images, a temporary layer cross-fades the two, committing
  only once the fade lands (image → video keeps the palette fade only: a video swap would need two live
  video elements). The window is opened from the switch itself and from `theme/change`, and is skipped
  for font-size-only changes and for the first snapshot.
- **Kept it cheap.** Those three properties are non-composited, so the scope adapts to the DOM: above
  ~1500 elements the window switches to a `lite` scope that transitions only `body` and the big
  surfaces instead of every descendant, and `prefers-reduced-motion` disables it. On the plugin's side,
  regions repaint only when their image really changed, an unchanged sticker is no longer torn down and
  re-decoded (which also stopped sticker videos from restarting on unrelated edits), and the settings
  UI re-render is deferred one frame so it does not compete with the palette repaint.
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

# dsh-image-skin — design notes

## Goal

Give the DSH web UI a **coarse** skin: replace the few large regions of the interface with the user's
own artwork, configured from a settings submenu, without patching DSH itself.

Non-goals: pixel-level theming (borders, bubbles, per-component colours), remote content, or any
change that is not reversible by disabling the plugin.

## Composition

DSH composes its web UI from a **profile**, and this package is one row in it:

- `package.json` declares `dsh.bundle.patch: ./cordis.patch.yml` and `dsh.client.platform: web`, so
  the loader mounts both halves of the plugin.
- `cordis.patch.yml` inserts the row `ui-image-skin`.
- **Host half** (`src/index.ts`) registers the durable settings namespace and owns every
  `/dsh-image-skin/*` route.
- **Browser half** (`src/client/index.ts`) binds that namespace, paints the regions, and registers
  the `settings.section` page.

`lib/index.js` (ESM) and `lib/client.js` (CommonJS wrapped in the client-modules
`window.__ModuleLoader__.load({ id, factory })` envelope) are the artifacts DSH actually loads, so
`lib/` is committed and `prepublishOnly` rebuilds it.

## Settings

`IMAGE_AREAS` in `src/index.ts` is the single source of truth: the schemastery shape is generated
from it, producing `${area}Image`, `${area}Enabled`, `${area}Fit`, `${area}OffsetX`, `${area}OffsetY`
and `${area}Scale` per area, plus the globals `enabled` and `panelOpacity`. Adding an area therefore
never needs a schema edit.

Only URLs are persisted — never payloads. Uploads live as files in `$DSH_HOME/image-skin/`
(`DSH_HOME` defaults to `~/.dsh`) and are served back from `/dsh-image-skin/files/<uuid>.<ext>`.

## Upload path

`POST /dsh-image-skin/upload` accepts `{ image: "data:<type>;base64,…" }`. The body is read through a
**streaming** cap (`MAX_UPLOAD_BYTES`, 32 MB of base64 envelope ≈ 24 MB of file) so an oversized
upload is rejected with `413` while it is still arriving, instead of being buffered first. The type
whitelist (`EXTENSIONS`) decides the extension; filenames are generated UUIDs, so a client-supplied
name can never reach the filesystem. The browser mirrors the limit with a pre-check and renders the
rejection reason in the settings page.

Trade-off: base64 inflates the payload by ~33 % and makes the browser hold a copy as a string. That
is why the limit exists at all; a future revision should post raw bytes with
`fetch(..., { body: file })` and stream straight to disk.

## Garbage collection

`POST /dsh-image-skin/gc` deletes stored files that no area references any more.

- The **keep set is computed on the host**, from the resolved settings value of the namespace
  (`settings.get`) — the client never supplies it, so a buggy or hostile client cannot ask for
  someone else's file to be deleted.
- A file younger than `GC_MIN_AGE_MS` (60 s) is never collected: between an upload and the settings
  write that references it, the file is legitimately unreferenced.
- If the namespace is not resolvable yet, the route answers `409` instead of treating "no settings"
  as "keep nothing".

The client triggers it after every image change (debounced, so the write has committed) and exposes
the same call as an explicit button.

## Painting the UI

**Regions.** `REGION_SELECTORS` maps an area id to one or more candidate selectors, tried in order.
The element that received the image is tagged `data-dsh-skin-region="<id>"`, which makes painting
idempotent: `regionApplied()` compares the tagged element with the currently mounted surface and the
inline `background-image` with the expected URL, so a repaint happens only when it is actually
needed. The window backdrop is special-cased: a video URL switches to a full-screen
`<video autoplay muted loop>` layer, anything else rides on `body`'s `background-image` and is
mirrored onto the sidebar column.

**Repair pass.** Region hosts mount and unmount while the app runs (`_hero` only exists on an empty
session, `_pane` only while the right panel is open), and a re-render can replace the element
carrying the inline style. A `MutationObserver` on `document.body` therefore schedules a throttled
(300 ms) repair. Two deliberate constraints:

- it observes `childList` + `subtree` and *only* the `data-ds-dark-theme` attribute, so the plugin's
  own inline styles and `data-*` tags can never re-trigger it (no feedback loop);
- it repaints **regions only** — never stickers — so an in-progress drag or resize is not
  interrupted by an unrelated DOM mutation.

**Stickers.** An `<img>` cannot carry a resize handle, so each sticker is a positioned `<div>`
wrapper appended to its host (`_composerSeat`, `_sidebarCol`). The host is given
`position: relative` when computed `static`, and marked so teardown can undo exactly that.

**Panel opacity.** `applyPanelOpacity()` writes one `<style>` block scoped to
`body[data-dsh-image-skin]` that overrides the documented surface tokens with `rgba(…, a)` where
`a = panelOpacity / 100`. The wallpaper is intentionally excluded from `a`: the slider exists to
reveal the wallpaper, so binding the video's opacity to it faded the backdrop out exactly when the
user wanted to see it. Sticker opacity does follow the slider, as an overlay that fades with the
chrome it sits on.

**Light / dark.** The scheme comes from the `theme` service (`getTheme().active.colorScheme`), not
from the body flag: the flag is applied a tick after a switch, which would leave the panel tint one
mode behind. `theme/change` is the continuous-sync signal, so images follow a switch made from DSH's
own Appearance setting, and the sun/moon slider writes back through `setTheme` — the documented single
preference-write entry — rather than styling around it. Every area resolves its image as
`<area>Image<Mode>` → `<area>Image` → nothing, so the per-mode fields are purely additive and the
shared field stays the lightweight default. `resolveAreaImage` is exported purely so the offline
client test can pin that fallback order.

**Video speed.** One `videoPlaybackRate` value is applied to every video the plugin renders — the
window layer and sticker videos — on both `playbackRate` (live) and `defaultPlaybackRate` (survives a
`src` swap). The slider previews it against the live elements before the debounced write lands.

## Teardown contract

Everything the plugin adds is registered on its own fiber and undone in `disposeSkinDom()`: window
background, sidebar mirror, video layer, sticker elements, the `position: relative` it added, the
editing affordance, and both injected `<style>` blocks. The settings namespace and the routes are
disposed with the fiber (`ctx.effect` returns the route disposer).

## Known limitations

- Region hosts are DSH internals addressed by CSS-module **class-name suffix**; a DSH release that
  renames them breaks region targeting (the settings page keeps working).
- The file route serves whole files without `Range` support and with `no-cache`; fine for a wallpaper,
  not a media server.
- Uploads are base64 data URIs (see above).
- `panelOpacity` overrides theme tokens globally for as long as the plugin is enabled: at very low
  values the UI is translucent, which is the point, but it does reduce contrast.

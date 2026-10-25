/**
 * Effort slider, folded into dsh-image-skin (2026-10-11).
 *
 * Ported verbatim from dsh-codex-effort-slider's browser half. Everything lives inside this one
 * function, so none of its names (NS, CSS, apply, inject, ...) collide with image-skin's own.
 * `React` and `require` resolve to the wrapping bundle scope, which image-skin already provides.
 *
 * @param ctx - the image-skin client context, already injected with the slider's services.
 */
export function activateEffortSlider(ctx) {
/**
 * dsh-codex-effort-slider - Browser half.
 *
 * A reproduction of **Codex's reasoning-effort card** for the DSH composer:
 * the dark rounded panel with the lightning mark, the `Ultra ›` / model-name
 * block, the fat pill track that fades blue-violet into deep violet, the white
 * round thumb parked at the right, the starfield inside the track and the
 * status ring on the right.
 *
 * Fidelity notes - the reference is Codex's own effort UI, and every constant
 * that Codex publishes in source is kept verbatim:
 *
 *  - the two accented tiers are `max` (`rgb(255,178,66)` on dark,
 *    `rgb(176,98,0)` on light) and `ultra` (`rgb(186,130,255)` /
 *    `rgb(124,58,217)`), with prompt glyphs `\u203A` and `\u00BB`; every other
 *    level stays neutral and carries no glyph (`codex-rs/tui/src/bottom_pane/effort_ignition.rs`);
 *  - the track gradient walks Codex's Ultra hue triple - `rgb(120,170,255)`
 *    blue into `rgb(186,130,255)` violet - which is exactly the blue-to-violet
 *    ramp the reference card shows;
 *  - the glyph "charges" from neutral into the accent over Codex's `CHARGE`
 *    (150 ms), capped at `PROMPT_ACCENT_ALPHA` (0.86);
 *  - a change into an accented tier replays Codex's one-shot ignition
 *    (Wave / Aurora / Pulse) with the same hues, the same 900/1250, 1000/1300
 *    and 1300/1600 ms durations, the same 33 ms frame tick, the same
 *    `ease_in_out` easing and the same `crest` falloff - the band maths below
 *    is a literal port of `effort_ignition_styles.rs`;
 *  - Codex's stepper bindings `alt(,)` / `alt(.)` step the focused control.
 *
 * Everything the card needs comes from existing plugins: `slots`, `locale`,
 * `theme`, `sessions` and the `modelDirectories` service owned by
 * `@deepseek-ai/dsh-client-ui-model-selection`. This half owns no durable state
 * beyond the in-flight drag.
 */


/** Dictionary namespace owned by this plugin. */
const NS = 'codex-effort'

/** Injected client services; the card renders once all of them exist. */
const inject = ['slots', 'locale', 'sessions', 'theme', 'remote', 'remote.session']

//#region Codex fidelity constants

/** Codex's accented tiers: primary accent (dark / light) plus the three ignition hues. */
const TIERS = {
  max: {
    glyph: '\u203A',
    label: 'MAX',
    accent: [255, 178, 66],
    accentLight: [176, 98, 0],
    hues: [[255, 178, 66], [255, 214, 120], [255, 120, 60]],
  },
  ultra: {
    glyph: '\u00BB',
    label: 'ULTRA',
    accent: [186, 130, 255],
    accentLight: [124, 58, 217],
    hues: [[186, 130, 255], [255, 120, 220], [120, 170, 255]],
  },
}

/**
 * The card's track ramp per tier. Codex only publishes the Ultra triple, so the
 * Ultra ramp *is* that triple walked blue -> violet; the Max ramp walks the Max
 * triple warm -> hot; every unaccented level stays cool grey.
 */
const TRACK_RAMPS = {
  /** Owner's spec (2026-10-06): blue -> violet at the top, solid blue below it. */
  solid: { dark: ['#3B82F6', '#3B82F6'], light: ['#2563EB', '#2563EB'] },
  ultra: { dark: ['#3D6FE8', '#A46BFF'], light: ['#2F6FE0', '#9257F0'] },
  max: { dark: ['#FFD678', '#FF783C'], light: ['#E8A64A', '#B06200'] },
  neutral: { dark: ['#8E92A0', '#C9CBD4'], light: ['#C9C9CF', '#9A9AA4'] },
}

/** Ids that mean "no thinking". Rendered dim, with no accent and no glyph. */
const OFF_EFFORT_IDS = ['off', 'none', 'disabled', 'minimal']

/** Starfield inside the track: `[fraction along the track, radius px, opacity]`. */
const SPARKS = [
  [0.06, 1.1, 0.9],
  [0.15, 0.7, 0.55],
  [0.24, 1.2, 0.85],
  [0.33, 0.8, 0.45],
  [0.42, 0.6, 0.35],
  [0.51, 1.0, 0.6],
  [0.6, 0.7, 0.4],
  [0.69, 0.9, 0.5],
  [0.78, 0.6, 0.3],
  [0.88, 0.8, 0.45],
]

/**
 * One copy of the moving starfield: `SPARKS` thinned 1-in-2 so the field reads as travel
 * rather than shimmer (dots ~52px apart). Each dot is a comet - bright head on the lead side
 * (right, the way the row travels) with a soft tail trailing left, so the eye reads direction.
 * The row renders two identical copies so sliding by one copy loops without a jump.
 */
function flowDots(keyPrefix) {
  return SPARKS.filter((entry, index) => index % 2 === 0).map((spark, index) => React.createElement('div', {
    key: `${keyPrefix}:${index}`,
    className: 'dshCodexEffort_flowDot',
    style: {
      left: `${(spark[0] * 100).toFixed(1)}%`,
      width: `${(spark[1] * 6).toFixed(1)}px`,
      height: `${(spark[1] * 2).toFixed(1)}px`,
      opacity: Math.min(0.95, 0.46 + spark[2] * 0.54),
    },
  }))
}

/**
 * Classify an adapter-owned effort id into a Codex tier.
 * @param effortId - adapter-owned reasoning effort id.
 * @returns the accented tier key, or null for a neutral level.
 */
function tierOf(effortId) {
  const id = String(effortId === undefined || effortId === null ? '' : effortId).toLowerCase()
  if (id.includes('ultra')) return 'ultra'
  if (id.includes('max') || id === 'xhigh' || id === 'extreme') return 'max'
  return null
}

/** Ignition style specification: per-tier total duration and band table (launch/speed, travel/phase, strength/hue). */
const IGNITION = {
  wave: { total: { max: 1000, ultra: 1300 }, bands: { max: [[0.1, 0.75, 1.0]], ultra: [[0.1, 0.7, 1.0], [0.35, 0.55, 1.0]] } },
  aurora: {
    total: { max: 1300, ultra: 1600 },
    bands: { max: [[0.35, 0.15, 0], [-0.5, 0.6, 1]], ultra: [[0.35, 0.15, 0], [-0.5, 0.6, 1], [0.75, 0.35, 2]] },
  },
  pulse: { total: { max: 900, ultra: 1250 }, bands: { max: [[0.1, 0.6, 1.0]], ultra: [[0.1, 0.55, 0.8], [0.45, 0.55, 1.1]] } },
}

/** Codex's `IGNITION_FRAME_TICK`: one rendered frame every 33 ms. */
const FRAME_MS = 33
/** Codex's `CHARGE`: how long the prompt glyph takes to reach its accent. */
const CHARGE_MS = 150
/** Codex's `PROMPT_ACCENT_ALPHA`: the glyph never reaches the full accent. */
const PROMPT_ACCENT_ALPHA = 0.86
/** `WAVE_HALF_WIDTH` from effort_ignition_styles.rs, in sampled columns. */
const WAVE_HALF_WIDTH = 9
/** `PULSE_HALF_WIDTH` from effort_ignition_styles.rs, in sampled columns. */
const PULSE_HALF_WIDTH = 4.5
/** Sampled columns per ignition frame; the gradient is rebuilt from these. */
const IGNITION_COLUMNS = 28
/** Ignition style order; a real tier change never repeats the previous style (Codex `IgnitionStyle::random`). */
const IGNITION_STYLES = ['wave', 'aurora', 'pulse']
/** Thumb diameter in px; the track's horizontal inset is half of it. */
const THUMB_SIZE = 24
/** Track height in px. */
const TRACK_HEIGHT = 30

/**
 * `crest` from effort_ignition_styles.rs.
 * @param distance - normalised distance from the band centre.
 * @returns the band weight at that distance.
 */
function crest(distance) {
  if (distance >= 1) return 0
  return 0.5 * (1 + Math.cos(Math.PI * distance))
}

/**
 * `ease_in_out` from effort_ignition_styles.rs.
 * @param progress - normalised progress in 0..1.
 * @returns the eased progress.
 */
function easeInOut(progress) {
  const p = Math.min(1, Math.max(0, progress))
  if (p < 0.5) return 4 * p * p * p
  const inverse = -2 * p + 2
  return 1 - (inverse * inverse * inverse) / 2
}

/**
 * `envelope` from effort_ignition_styles.rs (Aurora's fade in/out).
 * @param elapsed - seconds since the animation started.
 * @param total - total animation seconds.
 * @param fadeIn - fade-in seconds.
 * @param fadeOut - fade-out seconds.
 * @returns the envelope weight.
 */
function envelope(elapsed, total, fadeIn, fadeOut) {
  if (elapsed <= 0 || elapsed >= total) return 0
  const value = Math.min(elapsed / Math.max(fadeIn, Number.EPSILON), (total - elapsed) / Math.max(fadeOut, Number.EPSILON))
  return Math.min(1, Math.max(0, value))
}

/**
 * `band_sample` from effort_ignition_styles.rs.
 * @param style - ignition style key.
 * @param band - the band tuple.
 * @param elapsed - seconds since the animation started.
 * @param column - sampled column index.
 * @param width - sampled column count.
 * @returns `[hueIndex, strength]`.
 */
function bandSample(style, band, elapsed, column, width) {
  const first = band[0]
  const second = band[1]
  const third = band[2]
  if (style === 'wave') {
    const progress = (elapsed - first) / second
    if (!(progress >= 0 && progress <= 1)) return [0, 0]
    const center = easeInOut(progress) * (width + 2 * WAVE_HALF_WIDTH) - WAVE_HALF_WIDTH
    return [0, crest(Math.abs(column - center) / WAVE_HALF_WIDTH)]
  }
  if (style === 'aurora') {
    const center = (0.5 + 0.38 * Math.sin(2 * Math.PI * (first * elapsed + second))) * width
    const halfWidth = Math.max(width * 0.22, 4)
    return [third, crest(Math.abs(column - center) / halfWidth)]
  }
  const progress = (elapsed - first) / second
  if (!(progress >= 0 && progress <= 1)) return [0, 0]
  const inverse = 1 - progress
  const radius = (1 - inverse * inverse * inverse) * (width / 2 + 2 * PULSE_HALF_WIDTH)
  const distance = Math.abs(column - width / 2)
  return [0, crest(Math.abs(distance - radius) / PULSE_HALF_WIDTH) * third * (1 - 0.6 * progress)]
}

/**
 * Repaint one ignition frame as a CSS gradient - the web counterpart of
 * `paint_bands` + `Canvas::tint_column`.
 * @param style - ignition style key.
 * @param tier - accented tier key (`max` | `ultra`).
 * @param elapsedMs - milliseconds since the animation started.
 * @returns a `linear-gradient(...)` value, or null when nothing is lit.
 */
function ignitionGradient(style, tier, elapsedMs) {
  const spec = IGNITION[style]
  const totalSeconds = spec.total[tier] / 1000
  const elapsed = elapsedMs / 1000
  const hues = TIERS[tier].hues
  const bands = spec.bands[tier]
  const fade = style === 'aurora' ? envelope(elapsed, totalSeconds, 0.25, 0.4) : 1
  const stops = []
  let lit = false
  for (let column = 0; column < IGNITION_COLUMNS; column += 1) {
    const weights = [0, 0, 0]
    for (const band of bands) {
      const sample = bandSample(style, band, elapsed, column, IGNITION_COLUMNS)
      if (style === 'aurora') weights[sample[0]] += sample[1]
      else weights[sample[0]] = Math.max(weights[sample[0]], sample[1])
    }
    const weight = weights[0] + weights[1] + weights[2]
    const position = (((column + 0.5) / IGNITION_COLUMNS) * 100).toFixed(2)
    if (weight <= 0.01) {
      stops.push(`rgba(0, 0, 0, 0) ${position}%`)
      continue
    }
    lit = true
    let red = 0
    let green = 0
    let blue = 0
    for (let index = 0; index < 3; index += 1) {
      red += weights[index] * hues[index][0]
      green += weights[index] * hues[index][1]
      blue += weights[index] * hues[index][2]
    }
    const alpha = style === 'aurora' ? Math.min(weight * 0.4, 0.5) * fade : weight * 0.55
    stops.push(
      `rgba(${Math.round(red / weight)}, ${Math.round(green / weight)}, ${Math.round(blue / weight)}, ${alpha.toFixed(3)}) ${position}%`,
    )
  }
  return lit ? `linear-gradient(90deg, ${stops.join(', ')})` : null
}

//#endregion

//#region Pure selection helpers

/**
 * Resolve the reasoning metadata for the session's effective selection.
 * @param state - the shared model directory snapshot.
 * @returns `{current, model, reasoning, efforts}`, all possibly null/empty.
 */
function modelFacts(state) {
  const current = state === undefined || state === null ? null : state.current
  if (current === null || current === undefined) return { current: null, model: null, reasoning: null, efforts: [] }
  const groups = state.groups === undefined ? [] : state.groups
  for (const group of groups) {
    if (group.id !== current.provider) continue
    for (const model of group.models) {
      if (model.id !== current.model) continue
      const reasoning = model.reasoning === undefined || model.reasoning === null ? null : model.reasoning
      const efforts = reasoning === null || reasoning.efforts === undefined ? [] : reasoning.efforts
      return { current, model, reasoning, efforts }
    }
  }
  return { current, model: null, reasoning: null, efforts: [] }
}

/**
 * The level a session is actually on: the durable selection, else the model's default.
 * @param current - the session's effective selection, or null.
 * @param reasoning - the active model's reasoning metadata, or null.
 * @returns the effective effort id, or null when the adapter names no level.
 */
function effectiveEffortId(current, reasoning) {
  if (current !== null && current !== undefined && current.reasoningEffort !== undefined) return current.reasoningEffort
  if (reasoning === null || reasoning === undefined || reasoning.defaultEffort === undefined) return null
  return reasoning.defaultEffort
}

/**
 * Fractional thumb position for a discrete index.
 * @param index - active index.
 * @param count - number of stops.
 * @returns a unitless fraction in 0..1.
 */
function fractionOf(index, count) {
  if (count <= 1) return 0
  const clamped = Math.min(count - 1, Math.max(0, index))
  return clamped / (count - 1)
}

/**
 * Nearest stop for a pointer offset.
 * @param clientX - pointer x in viewport coordinates.
 * @param rect - the track's bounding client rect.
 * @param count - number of stops.
 * @param inset - horizontal inset of the usable span, in px.
 * @returns the snapped index.
 */
function indexAt(clientX, rect, count, inset) {
  if (count <= 1) return 0
  const pad = Math.min(inset === undefined ? THUMB_SIZE / 2 : inset, rect.width / 2)
  const usable = Math.max(1, rect.width - pad * 2)
  const ratio = (clientX - rect.left - pad) / usable
  const raw = Math.round(ratio * (count - 1))
  return Math.min(count - 1, Math.max(0, raw))
}

/**
 * The complete `ModelSelection` a level writes.
 * @param current - the session's effective selection.
 * @param effort - the chosen level.
 * @returns the selection to submit, or null when there is no model to keep.
 */
function selectionFor(current, effort) {
  if (current === null || current === undefined) return null
  return {
    provider: current.provider,
    model: current.model,
    ...(effort === undefined ? {} : { reasoningEffort: effort }),
  }
}

/**
 * Blend two rgb triples the way Codex's `blend` does.
 * @param from - source triple.
 * @param to - target triple.
 * @param amount - 0..1 mix towards `to`.
 * @returns the mixed triple.
 */
function blend(from, to, amount) {
  const t = Math.min(1, Math.max(0, amount))
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ]
}

/**
 * A tier's accent triple for the active colour scheme (Codex `accent_rgb`).
 * @param tier - accented tier key.
 * @param colorScheme - `light` or `dark`.
 * @returns the rgb triple.
 */
function accentTuple(tier, colorScheme) {
  return colorScheme === 'light' ? TIERS[tier].accentLight : TIERS[tier].accent
}

/**
 * The accent value for one level.
 * @param effort - the active advertised level, or null.
 * @param colorScheme - `light` or `dark`.
 * @returns a CSS colour (a literal `rgb(...)`, or a theme token for neutral levels).
 */
function accentFor(effort, colorScheme) {
  if (effort === null || effort === undefined) return 'var(--dsw-alias-label-primary)'
  const tier = tierOf(effort.id)
  if (tier !== null) return `rgb(${accentTuple(tier, colorScheme).join(', ')})`
  if (OFF_EFFORT_IDS.includes(String(effort.id).toLowerCase())) return 'var(--dsw-alias-label-secondary)'
  return 'var(--dsw-alias-label-primary)'
}

/**
 * The track's fill ramp for one level.
 * @param effort - the active advertised level, or null.
 * @param colorScheme - `light` or `dark`.
 * @returns a CSS `linear-gradient(...)` value.
 */
function trackGradient(effort, colorScheme) {
  const tier = effort === null ? null : tierOf(effort.id)
  // Unaccented levels keep the owner's solid blue; the accented top tier gets the blue -> violet run.
  const ramp = TRACK_RAMPS[tier === null ? 'solid' : 'ultra'][colorScheme === 'light' ? 'light' : 'dark']
  return `linear-gradient(90deg, ${ramp[0]} 0%, ${ramp[1]} 100%)`
}

//#endregion

//#region Styles

const STYLE_ID = 'dsh-codex-effort-slider'

const CSS = `
.dshCodexEffort{position:relative;margin-left:auto;--dsh-codex-effort-accent:var(--dsw-alias-label-primary);width:100%;max-width:344px;display:flex;flex-direction:column;gap:10px;padding:14px 16px 12px;border-radius:18px;background:var(--dsh-codex-effort-card,#212124);border:1px solid var(--dsh-codex-effort-card-line,rgba(255,255,255,.08));box-shadow:0 8px 24px rgba(0,0,0,.34),0 1px 0 rgba(255,255,255,.05) inset;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;user-select:none;-webkit-user-select:none;box-sizing:border-box}
/* owner's ask (2026-10-07): park the card on the RIGHT of the composer dock, not the left edge.
   Target the dock's direct child that holds the card, so it survives whatever wrapper the slot adds. */
[data-slot="conversation.input.dock"] > *:has(.dshCodexEffort){margin-left:auto}
/* The card is not part of the composer until asked for: the official model + reasoning seat
   in the input row is the switch. Nothing is shown until that seat is pressed. */
.dshCodexEffort:not([data-open="true"]){display:none}
.dshCodexEffort[data-disabled="true"]{opacity:.5;pointer-events:none}
.dshCodexEffort_mark{display:flex;align-items:center;justify-content:space-between;height:16px;color:var(--dsh-codex-effort-accent)}
.dshCodexEffort_markIcon{display:block;flex:none;filter:drop-shadow(0 0 6px color-mix(in srgb,var(--dsh-codex-effort-accent) 55%,transparent))}
.dshCodexEffort_head{display:flex;flex-direction:column;align-items:center;text-align:center;gap:1px}
.dshCodexEffort_title{display:inline-flex;align-items:center;gap:3px;font-size:15px;font-weight:600;line-height:22px;letter-spacing:.2px;color:var(--dsh-codex-effort-accent)}
.dshCodexEffort_glyph{font-weight:700;font-size:15px;line-height:1;transition:color .15s ease}
.dshCodexEffort_model{font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.dshCodexEffort_modelBtn{display:inline-flex;align-items:center;gap:4px;margin:0;padding:1px 6px;border:0;border-radius:9px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.dshCodexEffort_modelBtn:hover{background:rgba(255,255,255,.07)}
.dshCodexEffort_modelCaret{font-size:10px;line-height:1;opacity:.7}
.dshCodexEffort_modelWrap{position:relative;display:inline-flex;flex-direction:column;align-items:center;max-width:100%}
.dshCodexEffort_picker{position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);z-index:5;min-width:190px;max-width:min(300px,78vw);max-height:min(320px,55vh);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;display:flex;flex-direction:column;gap:1px;padding:5px;border-radius:12px;background:var(--dsh-codex-effort-card,#212124);border:1px solid var(--dsh-codex-effort-card-line,rgba(255,255,255,.12));box-shadow:0 14px 34px rgba(0,0,0,.45)}
.dshCodexEffort_pick{display:block;width:100%;padding:7px 10px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
.dshCodexEffort_pick:hover{background:rgba(255,255,255,.09)}
.dshCodexEffort_pick.is-on{color:var(--dsh-codex-effort-accent);font-weight:600}
.dshCodexEffort_flow{position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;transition:opacity .45s ease;contain:paint}
.dshCodexEffort_flowRow{position:absolute;top:0;left:0;height:100%;width:200%;will-change:transform;transform:translate3d(0,0,0);animation:dshCodexEffortFlow 6.5s linear infinite}
.dshCodexEffort_flowHalf{position:absolute;top:0;left:0;height:100%;width:50%}
.dshCodexEffort_flowHalf.is-b{left:50%}
.dshCodexEffort_flowDot{position:absolute;top:50%;border-radius:999px;background:radial-gradient(circle at 90% 50%,rgba(255,255,255,.95) 0 34%,rgba(255,255,255,0) 72%),linear-gradient(270deg,rgba(255,255,255,.8) 0%,rgba(255,255,255,.34) 45%,rgba(255,255,255,0) 100%);transform:translate(-50%,-50%)}
/* The starfield is drawn twice side by side and slid by exactly one copy, so the loop never jumps:
   the whole track is one conveyor - the dots travel right, toward the thumb, they do not blink in place.
   Transform only, so it rides the compositor instead of repainting the track every frame. */
@keyframes dshCodexEffortFlow{from{transform:translate3d(-50%,0,0)}to{transform:translate3d(0,0,0)}}
.dshCodexEffort[data-tier="max"] .dshCodexEffort_flow,.dshCodexEffort[data-tier="ultra"] .dshCodexEffort_flow{opacity:1}
/* (the first pass hid the model seat; it is visible again and now opens the card) */
.dshCodexEffort[data-tier="ultra"] .dshCodexEffort_trackBed::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(100deg,rgba(255,255,255,0) 18%,rgba(255,255,255,.9) 46%,rgba(255,255,255,0) 72%);transform:translateX(-130%);animation:dshCodexEffortSweep .9s cubic-bezier(.25,.9,.3,1) 1 forwards}
@keyframes dshCodexEffortSweep{to{transform:translateX(130%)}}
.dshCodexEffort[data-tier="ultra"] .dshCodexEffort_thumb{box-shadow:0 2px 6px rgba(0,0,0,.45),0 0 0 1px rgba(0,0,0,.06),0 0 16px 4px rgba(186,130,255,.6);animation:dshCodexEffortThumbPop .66s cubic-bezier(.18,1.6,.36,1) 1}
@keyframes dshCodexEffortThumbPop{0%{transform:scale(1)}32%{transform:scale(1.45)}70%{transform:scale(.97)}100%{transform:scale(1)}}
.dshCodexEffort[data-tier="ultra"] .dshCodexEffort_thumb::after{content:'';position:absolute;inset:-3px;border-radius:50%;pointer-events:none;border:2px solid rgba(205,160,255,.9);animation:dshCodexEffortRing .95s ease-out 1 forwards}
@keyframes dshCodexEffortRing{0%{transform:scale(.55);opacity:.95}70%{opacity:.35}100%{transform:scale(3);opacity:0}}
.dshCodexEffort[data-tier="ultra"]{animation:dshCodexEffortCardGlow 2.6s ease-in-out infinite}
@keyframes dshCodexEffortCardGlow{0%,100%{box-shadow:0 8px 24px rgba(0,0,0,.34),0 0 0 rgba(170,120,255,0)}50%{box-shadow:0 8px 24px rgba(0,0,0,.34),0 0 30px rgba(170,120,255,.34)}}
/* each flow dot carries its own soft glow, so the moving layer never runs a per-frame filter */
.dshCodexEffort_rail{position:relative;display:flex;align-items:center;gap:10px}
.dshCodexEffort_track{position:relative;flex:1 1 auto;height:${THUMB_SIZE}px;cursor:pointer;touch-action:none;outline:none}
.dshCodexEffort_track:focus-visible{box-shadow:0 0 0 2px color-mix(in srgb,var(--dsh-codex-effort-accent) 60%,transparent);border-radius:${TRACK_HEIGHT / 2 + 6}px}
.dshCodexEffort_trackBed{position:absolute;left:0;right:0;top:50%;height:${TRACK_HEIGHT}px;transform:translateY(-50%);border-radius:${TRACK_HEIGHT / 2}px;background:var(--dsh-codex-effort-bed,rgba(255,255,255,.12));overflow:hidden}
.dshCodexEffort_fill{position:absolute;left:0;top:0;bottom:0;width:calc(var(--dsh-codex-effort-p,0) * 100% + ${THUMB_SIZE / 2}px);border-radius:${TRACK_HEIGHT / 2}px;background:var(--dsh-codex-effort-ramp);transition:width .1s linear}
.dshCodexEffort[data-tier="max"] .dshCodexEffort_fill::after,.dshCodexEffort[data-tier="ultra"] .dshCodexEffort_fill::after{opacity:1}
/* (the old in-place twinkling sparks are gone - the dots now travel) */
.dshCodexEffort_ignition{position:absolute;left:0;right:0;top:50%;height:${TRACK_HEIGHT + 4}px;transform:translateY(-50%);border-radius:${(TRACK_HEIGHT + 4) / 2}px;opacity:0;pointer-events:none;will-change:background,opacity;mix-blend-mode:screen}
.dshCodexEffort_thumb{position:absolute;top:50%;left:calc(var(--dsh-codex-effort-p,0) * (100% - ${THUMB_SIZE}px) + ${THUMB_SIZE / 2}px);width:${THUMB_SIZE}px;height:${THUMB_SIZE}px;margin:-${THUMB_SIZE / 2}px 0 0 -${THUMB_SIZE / 2}px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.45),0 0 0 1px rgba(0,0,0,.06);transition:left .1s linear,transform .12s ease}
.dshCodexEffort_track:hover .dshCodexEffort_thumb{transform:scale(1.06)}
.dshCodexEffort_track[data-drag="true"] .dshCodexEffort_thumb{transform:scale(1.1);box-shadow:0 3px 10px rgba(0,0,0,.5),0 0 0 5px color-mix(in srgb,var(--dsh-codex-effort-accent) 20%,transparent)}
.dshCodexEffort_track[data-error="true"] .dshCodexEffort_trackBed{background:var(--dsw-alias-state-error-primary)}
.dshCodexEffort_ring{flex:none;width:16px;height:16px;color:var(--dsh-codex-effort-accent);opacity:.75}
.dshCodexEffort[data-busy="true"] .dshCodexEffort_ring{opacity:1;animation:dshCodexEffortSpin 1s linear infinite}
@keyframes dshCodexEffortSpin{to{transform:rotate(360deg)}}
`

/** Inject the plugin stylesheet once per document (the module loader's own idempotence is per materialization). */
function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(`${STYLE_ID}/client.css`)}]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = STYLE_ID
  tag.dataset.pluginCss = `${STYLE_ID}/client.css`
  tag.textContent = CSS
  document.head.appendChild(tag)
}

//#endregion

//#region Component

/**
 * Subscribe to a snapshot store without assuming React 18's `useSyncExternalStore` shims.
 * @param store - a store exposing `subscribe` + `getSnapshot`.
 * @returns the current snapshot.
 */
function useStore(store) {
  const subscribe = React.useCallback((listener) => store.subscribe(listener), [store])
  const getSnapshot = React.useCallback(() => store.getSnapshot(), [store])
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** The card's lightning mark (Codex's spark, drawn as a bolt with a soft glow). */
function MarkIcon() {
  return React.createElement('svg', {
    className: 'dshCodexEffort_markIcon',
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    'aria-hidden': true,
  }, React.createElement('path', {
    d: 'M9.1 1.2 3.4 8.6c-.3.4 0 .9.4.9H7l-.9 5.3c-.1.5.6.8.9.4l5.7-7.4c.3-.4 0-.9-.4-.9H9l.9-5.3c.1-.5-.6-.8-.8-.4Z',
    fill: 'currentColor',
  }))
}

/** The right-hand status ring; it spins while a selection is in flight. */
function StatusRing() {
  return React.createElement('svg', {
    className: 'dshCodexEffort_ring',
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    'aria-hidden': true,
  },
  React.createElement('circle', {
    cx: 8,
    cy: 8,
    r: 6,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeDasharray: '28 10',
    opacity: 0.9,
  }))
}

/**
 * Render the Codex-style reasoning-effort card.
 * @param props - the injected directory face, the theme mode store and the translator.
 * @returns the card, or null while the active model advertises no levels.
 */
function EffortCard(props) {
  const directory = props.directory
  const mode = props.mode
  const translate = props.t
  const state = useStore(directory)
  const colorScheme = useStore(mode)

  const facts = modelFacts(state)
  const efforts = facts.efforts
  const current = facts.current


  const loadRef = React.useRef(false)
  React.useEffect(() => {
    if (loadRef.current) return
    loadRef.current = true
    props.load()
  }, [props])

  const [dragIndex, setDragIndex] = React.useState(null)
  const [pickOpen, setPickOpen] = React.useState(false)
  /** Every model the catalog offers for this session (owner's ask: pick it right here). */
  const modelChoices = React.useMemo(() => {
    const groups = state !== null && state !== undefined && Array.isArray(state.groups) ? state.groups : []
    return groups.flatMap((group) => (group.models || []).map((model) => ({
      provider: group.id,
      model: model.id,
      name: model.name || model.id,
      reasoning: model.reasoning,
    })))
  }, [state])
  const isChosen = (choice) => state !== null && state !== undefined && state.current !== null && state.current !== undefined &&
    state.current.provider === choice.provider && state.current.model === choice.model
  const chooseModel = (choice) => {
    const selection = { provider: choice.provider, model: choice.model }
    if (choice.reasoning !== undefined && choice.reasoning !== null && choice.reasoning.defaultEffort !== undefined) {
      selection.reasoningEffort = choice.reasoning.defaultEffort
    }
    setPickOpen(false)
    try { props.select(selection) } catch { /* the seat reports failures itself */ }
  }
  const [pendingIndex, setPendingIndex] = React.useState(null)
  const [failed, setFailed] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const trackRef = React.useRef(null)
  const ignitionRef = React.useRef(null)

  const storeIndex = React.useMemo(() => {
    if (efforts.length === 0) return -1
    const id = effectiveEffortId(current, facts.reasoning)
    if (id === null) return -1
    return efforts.findIndex((effort) => effort.id === id)
  }, [efforts, current, facts.reasoning])

  React.useEffect(() => {
    if (pendingIndex !== null && storeIndex === pendingIndex) setPendingIndex(null)
  }, [pendingIndex, storeIndex])

  // Codex's ignition: one-shot, random style that never repeats, 33 ms frames.
  const ignition = React.useRef({ timer: null, style: null, start: 0, tier: null })
  const stopIgnition = React.useCallback(() => {
    const live = ignition.current
    if (live.timer !== null) clearTimeout(live.timer)
    live.timer = null
    if (ignitionRef.current !== null) {
      ignitionRef.current.style.opacity = '0'
      ignitionRef.current.style.background = 'none'
    }
  }, [])
  React.useEffect(() => stopIgnition, [stopIgnition])

  const playIgnition = React.useCallback((tier) => {
    if (typeof window === 'undefined') return
    stopIgnition()
    const live = ignition.current
    const options = IGNITION_STYLES.filter((style) => style !== live.style)
    const style = options[Math.floor(Math.random() * options.length)]
    live.style = style
    live.start = window.performance === undefined ? Date.now() : window.performance.now()
    const total = IGNITION[style].total[tier]
    const paint = () => {
      const node = ignitionRef.current
      const now = window.performance === undefined ? Date.now() : window.performance.now()
      const elapsed = now - live.start
      if (node === null || elapsed >= total) {
        stopIgnition()
        return
      }
      const gradient = ignitionGradient(style, tier, elapsed)
      node.style.background = gradient === null ? 'none' : gradient
      node.style.opacity = gradient === null ? '0' : '1'
      live.timer = window.setTimeout(paint, FRAME_MS)
    }
    paint()
  }, [stopIgnition])

  const activeIndex = dragIndex !== null ? dragIndex : pendingIndex !== null ? pendingIndex : storeIndex
  const activeEffort = activeIndex >= 0 && activeIndex < efforts.length ? efforts[activeIndex] : null
  // Owner's spec (2026-10-06): accent whatever the model's TOP level is. Codex names only max/ultra,
  // so a ladder that ends at xhigh (or anything else) must still get the violet run - hence position,
  // not id. This is what makes the card adapt to every model's own effort list.
  const isTopLevel = activeIndex >= 0 && efforts.length > 0 && activeIndex === efforts.length - 1
  const activeTier = activeEffort === null ? null : (isTopLevel ? 'ultra' : tierOf(activeEffort.id))
  const accent = React.useMemo(() => accentFor(activeEffort, colorScheme), [activeEffort, colorScheme])
  const ramp = React.useMemo(() => trackGradient(activeEffort, colorScheme), [activeEffort, colorScheme])

  const commit = React.useCallback((index) => {
    if (index < 0 || index >= efforts.length) return
    const effort = efforts[index]
    if (current === null || current === undefined) return
    if (index === storeIndex) return
    const selection = selectionFor(current, effort.id)
    if (selection === null) return
    setPendingIndex(index)
    setFailed(false)
    setBusy(true)
    const tier = tierOf(effort.id)
    if (tier !== null) playIgnition(tier)
    Promise.resolve(props.select(selection)).then((ok) => {
      setBusy(false)
      if (ok === false) {
        setPendingIndex(null)
        setFailed(true)
        window.setTimeout(() => setFailed(false), 1200)
      }
    }, () => {
      setBusy(false)
      setPendingIndex(null)
      setFailed(true)
      window.setTimeout(() => setFailed(false), 1200)
    })
  }, [efforts, current, storeIndex, props, playIgnition])

  const indexFromEvent = React.useCallback((event) => {
    const node = trackRef.current
    if (node === null) return activeIndex < 0 ? 0 : activeIndex
    return indexAt(event.clientX, node.getBoundingClientRect(), efforts.length, THUMB_SIZE / 2)
  }, [efforts.length, activeIndex])

  const onPointerDown = React.useCallback((event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    event.preventDefault()
    const node = trackRef.current
    if (node === null) return
    try {
      node.setPointerCapture(event.pointerId)
    } catch {
      /* capture is best-effort; dragging still works without it */
    }
    setDragIndex(indexFromEvent(event))
  }, [indexFromEvent])

  const onPointerMove = React.useCallback((event) => {
    if (dragIndex === null) return
    const next = indexFromEvent(event)
    if (next !== dragIndex) setDragIndex(next)
  }, [dragIndex, indexFromEvent])

  const onPointerUp = React.useCallback((event) => {
    if (dragIndex === null) return
    const target = indexFromEvent(event)
    const node = trackRef.current
    if (node !== null) {
      try {
        node.releasePointerCapture(event.pointerId)
      } catch {
        /* the pointer may already be released */
      }
    }
    setDragIndex(null)
    commit(target)
  }, [dragIndex, indexFromEvent, commit])

  const onKeyDown = React.useCallback((event) => {
    const key = event.key
    const last = efforts.length - 1
    const base = activeIndex < 0 ? 0 : activeIndex
    let next = null
    if (key === 'ArrowRight' || key === 'ArrowUp') next = Math.min(last, base + 1)
    else if (key === 'ArrowLeft' || key === 'ArrowDown') next = Math.max(0, base - 1)
    else if (key === 'Home') next = 0
    else if (key === 'End') next = last
    else if (key === 'PageUp') next = Math.min(last, base + 2)
    else if (key === 'PageDown') next = Math.max(0, base - 2)
    // Codex's own bindings: increase_reasoning_effort = alt('.'), decrease = alt(',').
    else if (event.altKey && key === '.') next = Math.min(last, base + 1)
    else if (event.altKey && key === ',') next = Math.max(0, base - 1)
    if (next === null) return
    event.preventDefault()
    commit(next)
  }, [efforts.length, activeIndex, commit])

  if (!props.available || efforts.length === 0) return null

  const fraction = fractionOf(activeIndex < 0 ? 0 : activeIndex, efforts.length)
  const valueLabel = activeEffort === null ? translate('value.default') : activeEffort.name
  const modelLabel = facts.model !== null && facts.model.name !== undefined
    ? facts.model.name
    : current === null ? '' : current.model

  const track = React.createElement(
    'div',
    {
      ref: trackRef,
      className: 'dshCodexEffort_track',
      role: 'slider',
      tabIndex: 0,
      'aria-label': translate('aria.label'),
      'aria-valuemin': 0,
      'aria-valuemax': Math.max(0, efforts.length - 1),
      'aria-valuenow': activeIndex < 0 ? 0 : activeIndex,
      'aria-valuetext': valueLabel,
      title: activeEffort === null || activeEffort.description === undefined
        ? translate('tip.drag')
        : `${valueLabel} - ${activeEffort.description} (${translate('tip.drag')})`,
      'data-drag': dragIndex !== null ? 'true' : 'false',
      'data-error': failed ? 'true' : 'false',
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onKeyDown,
      style: { '--dsh-codex-effort-p': String(fraction) },
    },
    React.createElement('div', { className: 'dshCodexEffort_trackBed' },
      React.createElement('div', { className: 'dshCodexEffort_fill' }),
      React.createElement('div', { className: 'dshCodexEffort_flow' },
        React.createElement('div', { className: 'dshCodexEffort_flowRow' },
          React.createElement('div', { className: 'dshCodexEffort_flowHalf' }, ...flowDots('a')),
          React.createElement('div', { className: 'dshCodexEffort_flowHalf is-b' }, ...flowDots('b'))))),
    React.createElement('div', { ref: ignitionRef, className: 'dshCodexEffort_ignition' }),
    React.createElement('div', { className: 'dshCodexEffort_thumb' }),
  )

  return React.createElement(
    'div',
    {
      className: 'dshCodexEffort',
      'data-tier': activeTier === null ? 'neutral' : activeTier,
      'data-disabled': failed ? 'true' : 'false',
      'data-busy': busy ? 'true' : 'false',
      style: {
        '--dsh-codex-effort-accent': accent,
        '--dsh-codex-effort-ramp': ramp,
        '--dsh-codex-effort-card': colorScheme === 'light' ? '#FFFFFF' : '#212124',
        '--dsh-codex-effort-card-line': colorScheme === 'light' ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.08)',
        '--dsh-codex-effort-bed': colorScheme === 'light' ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.1)',
      },
    },
    React.createElement('div', { className: 'dshCodexEffort_mark' }, React.createElement(MarkIcon)),
    React.createElement('div', { className: 'dshCodexEffort_head' },
      React.createElement('span', { className: 'dshCodexEffort_title' },
        valueLabel,
        activeTier === null ? null : React.createElement('span', {
          className: 'dshCodexEffort_glyph',
          style: { color: `rgba(${accentTuple(activeTier, colorScheme).join(', ')}, ${PROMPT_ACCENT_ALPHA})` },
          'aria-hidden': true,
        }, TIERS[activeTier].glyph)),
      modelLabel === '' ? null : React.createElement('div', { className: 'dshCodexEffort_modelWrap' },
        React.createElement('button', {
          type: 'button',
          className: 'dshCodexEffort_modelBtn',
          title: translate('tip.model'),
          onClick: (event) => { event.preventDefault(); event.stopPropagation(); setPickOpen((open) => !open) },
        },
          React.createElement('span', { className: 'dshCodexEffort_model' }, modelLabel),
          React.createElement('span', { className: 'dshCodexEffort_modelCaret' }, '\u25be')),
        pickOpen && modelChoices.length > 0 ? React.createElement('div', { className: 'dshCodexEffort_picker' },
          modelChoices.map((choice) => React.createElement('button', {
            key: `${choice.provider}:${choice.model}`,
            type: 'button',
            className: 'dshCodexEffort_pick' + (isChosen(choice) ? ' is-on' : ''),
            onClick: (event) => { event.preventDefault(); event.stopPropagation(); chooseModel(choice) },
          }, choice.name))) : null)),
    React.createElement('div', { className: 'dshCodexEffort_rail' }, track, React.createElement(StatusRing)),
  )
}

//#endregion

//#region Plugin

/**
 * Compose the card's theme-mode store: a stable primitive snapshot plus the
 * `theme/change` event as its notification source.
 * @param ctx - the client root context.
 * @returns `{getSnapshot, subscribe}`.
 */
function createModeStore(ctx) {
  const listeners = new Set()
  ctx.effect(() => ctx.on('theme/change', () => {
    for (const listener of [...listeners]) listener()
  }), 'codex-effort-slider: theme/change')
  return {
    getSnapshot: () => {
      try {
        const snapshot = ctx.theme.getTheme()
        return snapshot !== undefined && snapshot.active !== undefined ? snapshot.active.colorScheme : 'dark'
      } catch {
        return 'dark'
      }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/**
 * Client plugin body: register this plugin's dictionaries, then occupy the
 * composer's ambient dock below the composer card with the effort card.
 * @param ctx - client root context.
 * @returns nothing.
 */
function apply(ctx) {
  ensureStyles()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'codex-effort-slider: dictionaries')
  const t = ctx.locale.bind(NS)
  const mode = createModeStore(ctx)

  // Owner's ask (2026-10-07, second pass): the card must NOT sit in the composer all the time.
  // The official model + reasoning seat stays visible and acts as the switch: pressing it opens
  // the card; pressing outside, Escape, or the seat again closes it.
  ctx.effect(() => {
    const card = () => document.querySelector('.dshCodexEffort')
    const isOpen = () => { const el = card(); return el !== null && el.getAttribute('data-open') === 'true' }
    const setOpen = (open) => { const el = card(); if (el !== null) el.setAttribute('data-open', open ? 'true' : 'false') }
    const wired = new WeakSet()
    const wire = () => {
      const seats = document.querySelectorAll('[data-slot="conversation.input.model"]')
      for (const seat of seats) {
        // undo the first pass, which hid the seat
        seat.classList.remove('dshCodexEffort_seatHidden')
        delete seat.dataset.dshEffortReplaced
        if (wired.has(seat)) continue
        wired.add(seat)
        seat.addEventListener('click', (event) => {
          // keep the official menu from opening as well: React listens at the root, so stopping
          // propagation on the seat is enough.
          event.preventDefault()
          event.stopPropagation()
          setOpen(!isOpen())
        })
      }
    }
    wire()
    const observer = new MutationObserver(() => wire())
    observer.observe(document.body, { childList: true, subtree: true })
    const onDocumentClick = (event) => {
      if (!isOpen()) return
      const el = card()
      if (el !== null && event.target instanceof Node && el.contains(event.target)) return
      if (event.target instanceof Element && event.target.closest('[data-slot="conversation.input.model"]') !== null) return
      setOpen(false)
    }
    const onKeyDown = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('click', onDocumentClick, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      observer.disconnect()
      document.removeEventListener('click', onDocumentClick, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, 'codex-effort-slider: the seat opens the card')

  ctx.inject(['slots', 'modelDirectories'], (scope) => {
    const models = scope.modelDirectories
    const sessions = scope.sessions
    scope.slots.inject('conversation.input.dock', () => scope.slots.register({
      name: 'conversation.input.dock',
      id: 'codex-effort-slider',
      order: 10,
      locale: NS,
      inject: (sessionId) => {
        // Resolve the model directory lazily: it is owned by another client plugin, and gating the
        // whole registration on it meant this card silently never appeared.
        // directoryFor() runs loud on an unknown session, so keep it guarded.
        let directory = null
        try { directory = models.directoryFor(sessionId) } catch { directory = null }
        if (!directory) return { available: false, directory: { getSnapshot: () => null, subscribe: () => () => {} }, mode, load: () => {}, select: () => Promise.resolve(false) }
        const available = sessions.subagentAddress(sessionId) === undefined
        return {
          available,
          directory: directory.store,
          mode,
          load: () => {
            if (available) directory.load().catch(() => {})
          },
          select: (selection) => (available ? directory.select(selection).then(() => true, () => false) : Promise.resolve(false)),
        }
      },
    }, (props) => EffortCard({ ...props, t })))
  })
}

/** Localized copy owned by this plugin. */
const zh = {
  label: '\u63a8\u7406\u5f3a\u5ea6',
  'aria.label': '\u63a8\u7406\u5f3a\u5ea6',
  'tip.drag': '\u62d6\u52a8\u8c03\u6574\uff1b\u2325. \u63d0\u9ad8\u3001\u2325, \u964d\u4f4e',
  'tip.model': '\u9009\u62e9\u6a21\u578b',
  'value.default': '\u9ed8\u8ba4',
}
const en = {
  label: 'Reasoning',
  'aria.label': 'Reasoning effort',
  'tip.drag': 'drag, \u2325. up, \u2325, down',
  'tip.model': 'choose model',
  'value.default': 'Default',
}

//#endregion
  // Mirror the old plugin's activation: wait for its services, then run apply() on that scope.
  ctx.inject(inject, (scope) => apply(scope))
}

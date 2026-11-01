// Colour maths for Aoi.
//
// The bluescale transform works in OKLCH (perceptual lightness, chroma, hue):
//   - lightness is kept, so contrast and readability survive,
//   - hue becomes the palette's hue at that lightness, nudged a little by the
//     original hue so different colours stay tellable apart (green, red and
//     purple come out as different blues),
//   - chroma is clamped between a floor and the palette's chroma at that
//     lightness: vivid colours calm down to the palette, greys pick up a blue
//     tint, and pure white and black stay as they are.
(() => {
  const Aoi = (globalThis.Aoi ??= {});

  // ---------------------------------------------------------------- sRGB <-> OKLCH

  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

  function rgbToOklch(r, g, b) {
    const lr = toLinear(r / 255);
    const lg = toLinear(g / 255);
    const lb = toLinear(b / 255);
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    let H = (Math.atan2(B, A) * 180) / Math.PI;
    if (H < 0) H += 360;
    return { L, C: Math.hypot(A, B), H };
  }

  function oklchToLinearRgb(L, C, H) {
    const h = (H * Math.PI) / 180;
    const A = C * Math.cos(h);
    const B = C * Math.sin(h);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
  }

  const inGamut = (rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

  // OKLCH -> sRGB bytes. Out-of-gamut colours keep their lightness and hue and
  // lose chroma until they fit.
  function oklchToRgb(L, C, H) {
    let lin = oklchToLinearRgb(L, C, H);
    if (!inGamut(lin)) {
      let lo = 0;
      let hi = C;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (inGamut(oklchToLinearRgb(L, mid, H))) lo = mid;
        else hi = mid;
      }
      lin = oklchToLinearRgb(L, lo, H);
    }
    return lin.map((c) => Math.round(clamp01(toGamma(clamp01(c))) * 255));
  }

  // ---------------------------------------------------------------- palette ramp

  // A ramp is the palette's chromatic stops sorted by lightness. For any
  // lightness it answers "which hue, and how much chroma at most".
  function buildRamp(hexes) {
    return hexes
      .map((hex) => parseHex(hex))
      .map(([r, g, b]) => rgbToOklch(r, g, b))
      .filter((s) => s.C > 0.012)
      .sort((a, b) => a.L - b.L);
  }

  function lerpHue(a, b, t) {
    let d = b - a;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return (a + d * t + 360) % 360;
  }

  function rampAt(ramp, L) {
    const first = ramp[0];
    const last = ramp[ramp.length - 1];
    if (L <= first.L) return { H: first.H, C: first.C * Math.max(0, L / first.L) };
    if (L >= last.L) return { H: last.H, C: last.C * Math.max(0, (1 - L) / (1 - last.L)) };
    for (let i = 1; i < ramp.length; i++) {
      const b = ramp[i];
      if (L <= b.L) {
        const a = ramp[i - 1];
        const t = (L - a.L) / (b.L - a.L || 1);
        return { H: lerpHue(a.H, b.H, t), C: a.C + (b.C - a.C) * t };
      }
    }
    return { H: last.H, C: last.C };
  }

  // ---------------------------------------------------------------- the transform

  // How far an input hue pushes the output hue away from the palette hue.
  // The colour wheel is cut at red (3°) and laid out from -24° to +10°:
  // warm colours (red, orange, yellow, green) lean towards sky/azure blue,
  // blue (260°) stays at zero offset, purples lean slightly towards indigo.
  // The output never leaves the blue range, so nothing turns purple or teal.
  const hueOffset = (h) => -24 + 34 * (((h - 3 + 360) % 360) / 360);
  const HUE_MIN = 218;
  const HUE_MAX = 276;

  // opts: { ramp, keepReds, tint }
  //   tint: how much of the palette's chroma greys get (0 leaves greys grey).
  function bluescaleRgb(r, g, b, opts) {
    const { L, C, H } = rgbToOklch(r, g, b);
    if (opts.keepReds && C > 0.08 && (H < 45 || H > 345)) return null;
    const target = rampAt(opts.ramp, L);
    const neutral = C < 0.02; // hue of near-greys is noise, don't let it steer
    const hue = neutral ? target.H : Math.min(HUE_MAX, Math.max(HUE_MIN, target.H + hueOffset(H)));
    const floor = target.C * (opts.tint ?? 0);
    const chroma = Math.min(target.C, Math.max(C, floor));
    if (chroma < 0.002 && C < 0.002) return null; // white, black: untouched
    return oklchToRgb(L, chroma, hue);
  }

  // ---------------------------------------------------------------- palette helpers

  // Same lightness and hue, chroma scaled (the "colour strength" setting).
  function scaleHex(hex, factor) {
    const [r, g, b] = parseHex(hex);
    const { L, C, H } = rgbToOklch(r, g, b);
    if (C < 0.01) return hex;
    return formatColor(oklchToRgb(L, C * factor, H), 1);
  }

  // A set of distinct palette tones for things that need a colour per name
  // (mail labels and the like). Each tone has a background, a readable
  // foreground and a slightly deeper border.
  const TONE_SPOTS = [
    [0.87, -14], [0.72, 2], [0.8, 10], [0.6, -6], [0.9, 6],
    [0.66, -20], [0.76, -10], [0.52, 4], [0.84, -2], [0.68, -16],
  ];
  function makeTones(ramp) {
    return TONE_SPOTS.map(([L, dh]) => {
      const t = rampAt(ramp, L);
      const H = Math.min(HUE_MAX, Math.max(HUE_MIN, t.H + dh));
      const bg = oklchToRgb(L, t.C, H);
      const dark = rampAt(ramp, 0.34);
      const fg = L < 0.68 ? [255, 255, 255] : oklchToRgb(0.34, dark.C, H);
      const border = oklchToRgb(L - 0.06, rampAt(ramp, L - 0.06).C, H);
      return { bg: formatColor(bg, 1), fg: formatColor(fg, 1), border: formatColor(border, 1) };
    });
  }

  // Stable small hash (FNV-1a) so a name always gets the same tone.
  function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // ---------------------------------------------------------------- parsing

  function parseHex(str) {
    let h = str.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = parseInt(h, 16);
    if (Number.isNaN(n)) return null;
    if (h.length === 6) return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      parseInt(h.slice(6, 8), 16) / 255,
    ];
  }

  const NUM = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
  const FUNC_RE = new RegExp(
    String.raw`^(rgba?|hsla?)\(\s*(${NUM})(%|deg|turn|rad|grad)?\s*[,\s]\s*(${NUM})(%)?\s*[,\s]\s*(${NUM})(%)?\s*(?:[,/]\s*(${NUM})(%)?\s*)?\)$`,
    'i',
  );

  function hslToRgb(h, s, l) {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0) * 255, f(8) * 255, f(4) * 255];
  }

  function parseFunc(str) {
    const m = FUNC_RE.exec(str);
    if (!m) return null;
    const fn = m[1].toLowerCase();
    const alpha = m[8] === undefined ? 1 : clamp01(m[9] ? +m[8] / 100 : +m[8]);
    if (fn.startsWith('rgb')) {
      const ch = (v, pct) => Math.round(clamp01(pct ? +v / 100 : +v / 255) * 255);
      return [ch(m[2], m[3] === '%'), ch(m[4], m[5]), ch(m[6], m[7]), alpha];
    }
    let h = +m[2];
    if (m[3] === 'turn') h *= 360;
    else if (m[3] === 'rad') h = (h * 180) / Math.PI;
    else if (m[3] === 'grad') h *= 0.9;
    h = ((h % 360) + 360) % 360;
    const [r, g, b] = hslToRgb(h, clamp01(+m[4] / 100), clamp01(+m[6] / 100));
    return [Math.round(r), Math.round(g), Math.round(b), alpha];
  }

  // Anything the fast paths don't understand (named colours, oklch(), lab(),
  // color(), hwb()...) is resolved by letting the browser paint it on a 1x1 canvas.
  let ctx = null;
  function parseWithCanvas(str) {
    if (typeof OffscreenCanvas === 'undefined') return null;
    if (!ctx) ctx = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#010203';
    ctx.fillStyle = str;
    if (ctx.fillStyle === '#010203' && str.toLowerCase() !== '#010203') return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  }

  function parseColor(str) {
    const s = str.trim();
    if (s[0] === '#') return parseHex(s);
    return parseFunc(s) ?? parseWithCanvas(s);
  }

  const hex2 = (n) => n.toString(16).padStart(2, '0');
  function formatColor([r, g, b], alpha) {
    if (alpha >= 1) return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
    return `rgb(${r} ${g} ${b} / ${+alpha.toFixed(3)})`;
  }

  // ---------------------------------------------------------------- value rewriting

  // prettier-ignore
  const NAMED = ['aliceblue','antiquewhite','aqua','aquamarine','azure','beige','bisque','blanchedalmond','blue','blueviolet','brown','burlywood','cadetblue','chartreuse','chocolate','coral','cornflowerblue','cornsilk','crimson','cyan','darkblue','darkcyan','darkgoldenrod','darkgreen','darkkhaki','darkmagenta','darkolivegreen','darkorange','darkorchid','darkred','darksalmon','darkseagreen','darkslateblue','darkturquoise','darkviolet','deeppink','deepskyblue','dodgerblue','firebrick','floralwhite','forestgreen','fuchsia','gold','goldenrod','green','greenyellow','honeydew','hotpink','indianred','indigo','ivory','khaki','lavender','lavenderblush','lawngreen','lemonchiffon','lightblue','lightcoral','lightcyan','lightgoldenrodyellow','lightgreen','lightpink','lightsalmon','lightseagreen','lightskyblue','lightsteelblue','lightyellow','lime','limegreen','linen','magenta','maroon','mediumaquamarine','mediumblue','mediumorchid','mediumpurple','mediumseagreen','mediumslateblue','mediumspringgreen','mediumturquoise','mediumvioletred','midnightblue','mintcream','mistyrose','moccasin','navajowhite','navy','oldlace','olive','olivedrab','orange','orangered','orchid','palegoldenrod','palegreen','paleturquoise','palevioletred','papayawhip','peachpuff','peru','pink','plum','powderblue','purple','rebeccapurple','red','rosybrown','royalblue','saddlebrown','salmon','sandybrown','seagreen','seashell','sienna','skyblue','slateblue','springgreen','steelblue','tan','teal','thistle','tomato','turquoise','violet','wheat','yellow','yellowgreen'];
  const NAMED_SET = new Set(NAMED);

  // One pass over a declaration value. Groups:
  //   1 url(...) or a quoted string: copied through untouched
  //   2 hex colour   3 colour function   4 named colour
  const TOKEN_RE = new RegExp(
    [
      String.raw`(url\([^)]*\)|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')`,
      String.raw`((?<![\w-])#[0-9a-f]{3,8}(?![\w-]))`,
      String.raw`((?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\((?:[^()]|\([^()]*\))*\))`,
      String.raw`((?<![\w-])(?:${NAMED.join('|')})(?![\w-]))`,
    ].join('|'),
    'gi',
  );

  // Split "a b c / alpha" at its last top-level slash.
  function splitAlpha(args) {
    let depth = 0;
    for (let i = args.length - 1; i >= 0; i--) {
      const ch = args[i];
      if (ch === ')') depth++;
      else if (ch === '(') depth--;
      else if (ch === '/' && depth === 0) return [args.slice(0, i), args.slice(i + 1)];
    }
    return null;
  }

  class Mapper {
    constructor(opts) {
      this.opts = opts;
      this.tokens = new Map();
      this.values = new Map();
    }

    token(tok) {
      let out = this.tokens.get(tok);
      if (out !== undefined) return out;
      out = this.computeToken(tok);
      if (this.tokens.size > 20000) this.tokens.clear();
      this.tokens.set(tok, out);
      return out;
    }

    computeToken(tok) {
      let alphaExpr = null;
      let rgba = tok.includes('var(') ? null : parseColor(tok);
      if (!rgba && tok.includes('var(')) {
        // Tailwind-style rgb(59 130 246 / var(--tw-bg-opacity)): the channels
        // are literal, only the alpha is a variable. Recolour the channels.
        const open = tok.indexOf('(');
        const parts = splitAlpha(tok.slice(open + 1, -1));
        if (parts && !parts[0].includes('var(')) {
          rgba = parseColor(`${tok.slice(0, open)}(${parts[0]})`);
          alphaExpr = parts[1].trim();
        }
      }
      if (!rgba || rgba[3] === 0) return tok;
      const rgb = bluescaleRgb(rgba[0], rgba[1], rgba[2], this.opts);
      if (!rgb) return tok;
      if (alphaExpr) return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / ${alphaExpr})`;
      return formatColor(rgb, rgba[3]);
    }

    // Rewrites every colour inside a CSS value. Custom properties only get
    // a bare named colour rewritten when it is the whole value, so things like
    // `--animation: tan` style identifiers are never touched by accident.
    value(prop, value) {
      const custom = prop.charCodeAt(0) === 45 && prop.charCodeAt(1) === 45;
      const key = (custom ? '1' : '0') + value;
      let out = this.values.get(key);
      if (out !== undefined) return out;
      if (custom && NAMED_SET.has(value.trim().toLowerCase())) {
        out = value.replace(value.trim(), this.token(value.trim()));
      } else {
        out = value.replace(TOKEN_RE, (m, skip, hex, fn, named) => {
          if (skip) return m;
          if (named && custom) return m;
          return this.token(m);
        });
      }
      if (this.values.size > 20000) this.values.clear();
      this.values.set(key, out);
      return out;
    }
  }

  Aoi.color = {
    rgbToOklch,
    oklchToRgb,
    buildRamp,
    rampAt,
    bluescaleRgb,
    scaleHex,
    makeTones,
    hashString,
    parseColor,
    parseHex,
    formatColor,
    Mapper,
  };
})();

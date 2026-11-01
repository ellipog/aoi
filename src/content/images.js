// Palette images: an SVG gradient-map filter that turns every image into
// palette tones (dark parts become Ink, light parts become Paper, everything in
// between follows the palette). Hovering an image, or the link around it,
// shows the original.
(() => {
  const Aoi = globalThis.Aoi;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const FILTER_ID = 'aoi-palette-filter';

  let svg = null;
  let style = null;

  function svgEl(name, attrs, children = []) {
    const el = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    for (const child of children) el.appendChild(child);
    return el;
  }

  function buildFilter(palette) {
    // Palette stops sorted dark -> light become one lookup table per channel.
    const stops = palette.map((p) => Aoi.color.parseHex(p.hex)).sort(
      (a, b) => Aoi.color.rgbToOklch(...a).L - Aoi.color.rgbToOklch(...b).L,
    );
    const table = (ch) => stops.map((s) => (s[ch] / 255).toFixed(4)).join(' ');
    const luma = '0.2126 0.7152 0.0722 0 0';
    return svgEl(
      'svg',
      { 'aria-hidden': 'true', width: '0', height: '0', 'data-aoi': 'images', style: 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none' },
      [
        svgEl('filter', { id: FILTER_ID, 'color-interpolation-filters': 'sRGB' }, [
          svgEl('feColorMatrix', { type: 'matrix', values: `${luma} ${luma} ${luma} 0 0 0 1 0` }),
          svgEl('feComponentTransfer', {}, [
            svgEl('feFuncR', { type: 'table', tableValues: table(0) }),
            svgEl('feFuncG', { type: 'table', tableValues: table(1) }),
            svgEl('feFuncB', { type: 'table', tableValues: table(2) }),
          ]),
        ]),
      ],
    );
  }

  const CSS = `
    img, svg image {
      filter: url(#${FILTER_ID}) !important;
    }
    img:hover, svg:hover image,
    :is(a, button, figure, picture, [role="link"], [role="button"]):hover img {
      filter: none !important;
    }`;

  function mount() {
    const parent = document.body ?? document.documentElement;
    if (!parent) return;
    if (!svg.isConnected) parent.appendChild(svg);
    if (!style.isConnected) (document.head ?? document.documentElement).appendChild(style);
  }

  Aoi.images = {
    enable(palette) {
      this.disable();
      svg = buildFilter(palette);
      style = document.createElement('style');
      style.setAttribute('data-aoi', 'images');
      style.textContent = CSS;
      mount();
      // At document_start there is no <body> yet; move the filter in once there is.
      if (!document.body) document.addEventListener('DOMContentLoaded', () => svg && mount(), { once: true });
    },
    disable() {
      svg?.remove();
      style?.remove();
      svg = style = null;
    },
  };
})();

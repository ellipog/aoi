// The Aoi palette: the blues of the reference artwork's hair, at the
// saturation the hair *looks* (the raw pixels are greyer than they appear next
// to the warm white around them). Hue sits around 262°, the hair's own hue.
//
// Everything else (recipes, the bluescale ramp, the image filter, the popup)
// is derived from this list, so swapping these values re-themes the whole
// extension. The "colour strength" setting scales the chroma of these colours.
(() => {
  const Aoi = (globalThis.Aoi ??= {});

  Aoi.PALETTE = [
    { name: 'Paper', hex: '#fdfdfd', note: 'background white' },
    { name: 'Ice', hex: '#dbf5ff', note: 'brightest highlights' },
    { name: 'Frost', hex: '#c1e0ff', note: 'light hair' },
    { name: 'Sky', hex: '#98c4fe', note: 'lit hair' },
    { name: 'Cornflower', hex: '#709eec', note: 'hair mid-tone' },
    { name: 'Blue', hex: '#4c7ad3', note: 'main hair colour' },
    { name: 'Cobalt', hex: '#375eb5', note: 'hair shadow' },
    { name: 'Ink', hex: '#29438c', note: 'deepest shadow' },
  ];
})();

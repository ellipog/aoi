// Settings shared by the content script, popup and background worker.
(() => {
  const Aoi = (globalThis.Aoi ??= {});

  // Modes stack up: each one includes everything from the modes before it.
  Aoi.MODES = ['off', 'recipes', 'bluescale', 'images'];

  Aoi.MODE_INFO = {
    off: { label: 'Off', hint: 'Leave this site as it is' },
    recipes: { label: 'Recipes', hint: 'Hand-made tweaks for sites Aoi knows' },
    bluescale: { label: 'Bluescale', hint: 'Every colour on the page turns blue' },
    images: { label: 'Bluescale + images', hint: 'Images in palette tones too, hover to see the original' },
  };

  Aoi.DEFAULTS = {
    enabled: true, // master switch
    defaultMode: 'recipes', // for sites without their own setting
    keepReds: false, // leave strong reds alone so errors still read as errors
    strength: 50, // colour strength, 0-100 (50 = the palette as defined)
    sites: {}, // hostname -> mode
  };

  Aoi.siteKey = (hostname) => (hostname || '').toLowerCase().replace(/^www\./, '');

  Aoi.modeFor = (settings, host) => {
    if (!settings.enabled) return 'off';
    const mode = settings.sites[host] ?? settings.defaultMode;
    return Aoi.MODES.includes(mode) ? mode : 'off';
  };

  Aoi.loadSettings = () => chrome.storage.sync.get(Aoi.DEFAULTS);

  Aoi.saveSettings = (patch) => chrome.storage.sync.set(patch);

  Aoi.setSiteMode = async (host, mode) => {
    const { sites } = await chrome.storage.sync.get({ sites: {} });
    sites[host] = mode;
    await chrome.storage.sync.set({ sites });
  };

  Aoi.recipesFor = (host) => (Aoi.recipes ?? []).filter((r) => r.match(host));

  // ---- derived colours (need palette.js and color.js loaded) ----

  // Strength 0-100 scales palette chroma from 0.35x (soft, close to the raw
  // artwork) through 1x at 50 to 1.65x (vivid).
  const chromaFactor = (strength) => 0.35 + 1.3 * (Math.min(100, Math.max(0, strength ?? 50)) / 100);

  Aoi.paletteFor = (settings) => {
    const k = chromaFactor(settings.strength);
    return Aoi.PALETTE.map((c) => ({ ...c, hex: Aoi.color.scaleHex(c.hex, k) }));
  };

  // CSS custom properties exposed to recipes: --aoi-paper, --aoi-ice, ...
  Aoi.paletteVars = (palette) => palette.map((c) => `--aoi-${c.name.toLowerCase()}: ${c.hex};`).join(' ');

  Aoi.bluescaleOptions = (settings, palette = Aoi.paletteFor(settings)) => ({
    ramp: Aoi.color.buildRamp(palette.map((p) => p.hex)),
    keepReds: settings.keepReds,
    // greys pick up more blue as strength goes up
    tint: 0.25 + 0.4 * ((settings.strength ?? 50) / 100),
  });
})();

// Content script entry point: reads the settings for this site and turns the
// layers on or off. Settings changes from the popup apply live, no reload.
(() => {
  const Aoi = globalThis.Aoi;
  const host = Aoi.siteKey(location.hostname);
  if (!host || !document.documentElement) return;

  const engine = new Aoi.Engine();
  const live = new Aoi.Live();
  const recipes = Aoi.recipesFor(host);
  let recipeStyle = null;
  let applied = '';
  let mode = 'off';

  function setRecipes(on, palette) {
    if (!on || !recipes.length) {
      recipeStyle?.remove();
      recipeStyle = null;
      return;
    }
    if (!recipeStyle) {
      recipeStyle = document.createElement('style');
      recipeStyle.setAttribute('data-aoi', 'recipes');
    }
    recipeStyle.textContent = `:root { ${Aoi.paletteVars(palette)} }\n${recipes.map((r) => r.css ?? '').join('\n')}`;
    placeRecipes();
  }

  // Keep the recipe sheet last in <head> so it wins ties with the page's CSS.
  function placeRecipes() {
    if (!recipeStyle) return;
    const parent = document.head ?? document.documentElement;
    if (recipeStyle.parentNode !== parent || recipeStyle.nextElementSibling) parent.appendChild(recipeStyle);
  }
  document.addEventListener('DOMContentLoaded', placeRecipes, { once: true });

  function apply(settings) {
    mode = Aoi.modeFor(settings, host);
    const level = Aoi.MODES.indexOf(mode);
    const key = `${mode}|${settings.keepReds}|${settings.strength}`;
    if (key === applied) return;
    applied = key;

    const palette = Aoi.paletteFor(settings);
    const options = Aoi.bluescaleOptions(settings, palette);
    const liveRules = recipes.flatMap((r) => r.live ?? []);

    // Each layer is independent: one failing must not block the others.
    layer(() => setRecipes(level >= 1, palette));
    layer(() =>
      level >= 1 && liveRules.length
        ? live.start(liveRules, {
            mapper: new Aoi.color.Mapper(options),
            tones: Aoi.color.makeTones(options.ramp),
            memory: toneMemory,
          })
        : live.stop(),
    );
    layer(() => (level >= 2 ? engine.start(options) : engine.stop()));
    layer(() => (level >= 3 ? Aoi.images.enable(palette) : Aoi.images.disable()));
  }

  function layer(fn) {
    try {
      fn();
    } catch (err) {
      console.warn('[aoi]', err);
    }
  }

  // Which tone each name (e.g. a mail label) got on this site, kept in local
  // storage so labels keep their colour across reloads.
  const toneMemory = {
    names: {},
    timer: null,
    save() {
      clearTimeout(this.timer);
      this.timer = setTimeout(async () => {
        const { labelTones } = await chrome.storage.local.get({ labelTones: {} });
        labelTones[host] = { ...labelTones[host], ...this.names };
        await chrome.storage.local.set({ labelTones });
      }, 400);
    },
  };

  Promise.all([Aoi.loadSettings(), chrome.storage.local.get({ labelTones: {} })]).then(([settings, local]) => {
    toneMemory.names = local.labelTones[host] ?? {};
    apply(settings);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') Aoi.loadSettings().then(apply);
  });

  // The popup pings the tab to learn whether Aoi is running here.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'aoi:ping') sendResponse({ host, mode });
  });
})();

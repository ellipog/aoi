const Aoi = globalThis.Aoi;
const $ = (id) => document.getElementById(id);

// Pages Chrome never lets extensions touch, even over http(s).
const PROTECTED_HOSTS = ['chromewebstore.google.com', 'chrome.google.com'];

// What each mode does to a few typical page colours (red, green, grey, blue).
const SAMPLE = ['#e5534b', '#2da44e', '#8c959f', '#0969da'];

let settings = null;
let host = null;

const swatch = (palette, name) => palette.find((c) => c.name === name).hex;

function previewFor(mode, palette) {
  const el = document.createElement('span');
  el.className = 'preview';
  el.setAttribute('aria-hidden', 'true');
  if (mode === 'images') {
    el.classList.add('ramp');
    const ramp = palette.map((p) => p.hex).reverse();
    el.style.background = `linear-gradient(90deg, ${ramp.join(', ')})`;
    return el;
  }
  let colors = SAMPLE;
  if (mode === 'recipes') colors = ['Frost', 'Cornflower', 'Blue', 'Ink'].map((n) => swatch(palette, n));
  if (mode === 'bluescale') {
    const mapper = new Aoi.color.Mapper(Aoi.bluescaleOptions(settings, palette));
    colors = SAMPLE.map((c) => mapper.token(c));
  }
  for (const c of colors) {
    const cell = document.createElement('span');
    cell.style.background = c;
    el.appendChild(cell);
  }
  return el;
}

function renderModes(palette) {
  const list = $('modes');
  list.textContent = '';
  const explicit = host ? settings.sites[host] : undefined;
  const chosen = explicit ?? settings.defaultMode;

  for (const mode of Aoi.MODES) {
    const info = Aoi.MODE_INFO[mode];
    const btn = document.createElement('button');
    btn.className = 'mode';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(mode === chosen));
    btn.disabled = !host;
    const text = document.createElement('span');
    const b = document.createElement('b');
    b.textContent = info.label;
    const small = document.createElement('small');
    small.textContent = info.hint;
    text.append(b, small);
    btn.append(previewFor(mode, palette), text);
    btn.addEventListener('click', () => pickMode(mode));
    list.appendChild(btn);
  }

  list.classList.toggle('dimmed', !settings.enabled || !host);
  $('useDefault').hidden = !host || explicit === undefined;
  const hostEl = $('host');
  hostEl.textContent = host ?? 'No site';
  if (host && explicit === undefined) {
    const tag = document.createElement('small');
    tag.textContent = 'using default';
    hostEl.appendChild(tag);
  }
}

function strengthHint(value) {
  if (value < 25) return 'Soft, close to the raw artwork';
  if (value <= 65) return 'Like the hair';
  return 'Vivid';
}

function render() {
  const palette = Aoi.paletteFor(settings);
  $('enabled').checked = settings.enabled;
  $('keepReds').checked = settings.keepReds;
  $('defaultMode').value = settings.defaultMode;
  $('strength').value = settings.strength;
  $('strengthHint').textContent = strengthHint(settings.strength);
  renderModes(palette);
  renderPalette(palette);
}

async function update(patch) {
  Object.assign(settings, patch);
  await Aoi.saveSettings(patch);
  render();
}

async function pickMode(mode) {
  const sites = { ...settings.sites, [host]: mode };
  await update(settings.enabled ? { sites } : { sites, enabled: true });
}

function notice(text) {
  $('notice').textContent = text;
  $('notice').hidden = !text;
}

async function init() {
  settings = await Aoi.loadSettings();

  const select = $('defaultMode');
  for (const mode of Aoi.MODES) {
    const opt = document.createElement('option');
    opt.value = mode;
    opt.textContent = Aoi.MODE_INFO[mode].label;
    select.appendChild(opt);
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url = null;
  try {
    url = new URL(tab?.url ?? '');
  } catch {
    // no URL (e.g. a tab still loading)
  }
  const scriptable = url && /^https?:$/.test(url.protocol) && !PROTECTED_HOSTS.includes(url.hostname);
  if (scriptable) host = Aoi.siteKey(url.hostname);

  const recipes = host ? Aoi.recipesFor(host) : [];
  if (recipes.length) {
    $('recipe').hidden = false;
    $('recipe').textContent = `${recipes.map((r) => r.name).join(' + ')} recipe`;
    $('recipe').title = recipes.map((r) => r.description).join('\n');
  }

  render();

  if (!scriptable) {
    notice("Chrome doesn't let extensions restyle this page.");
  } else {
    // A tab opened before Aoi was installed or reloaded has no content script yet.
    const running = await chrome.tabs.sendMessage(tab.id, { type: 'aoi:ping' }).catch(() => null);
    if (!running) notice('Reload this tab to start Aoi on it.');
  }

  $('enabled').addEventListener('change', (e) => update({ enabled: e.target.checked }));
  $('keepReds').addEventListener('change', (e) => update({ keepReds: e.target.checked }));
  // Preview while dragging; save (and recolour the page) on release.
  $('strength').addEventListener('input', (e) => {
    settings.strength = Number(e.target.value);
    render();
  });
  $('strength').addEventListener('change', (e) => update({ strength: Number(e.target.value) }));
  select.addEventListener('change', (e) => update({ defaultMode: e.target.value }));
  $('useDefault').addEventListener('click', () => {
    const sites = { ...settings.sites };
    delete sites[host];
    update({ sites });
  });

  // The keyboard shortcut can change settings while the popup is open.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'sync') return;
    settings = await Aoi.loadSettings();
    render();
  });
}

const HINT = $('hint').innerHTML;
let hintTimer = null;

function renderPalette(palette) {
  const strip = $('palette');
  strip.textContent = '';
  for (const color of palette) {
    const btn = document.createElement('button');
    btn.style.background = color.hex;
    btn.title = `${color.name} ${color.hex} (${color.note})`;
    btn.setAttribute('aria-label', `Copy ${color.name} ${color.hex}`);
    btn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(color.hex);
      $('hint').textContent = `Copied ${color.name} ${color.hex}`;
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => ($('hint').innerHTML = HINT), 1400);
    });
    strip.appendChild(btn);
  }
}

init();

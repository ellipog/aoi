// Background service worker.
//  - Fetches cross-origin stylesheets for the bluescale engine (pages can't
//    read those themselves; the extension can, thanks to its host permission).
//  - Handles the keyboard shortcut that cycles the current site's mode.
importScripts('shared/settings.js');

const Aoi = globalThis.Aoi;
const MAX_CSS_BYTES = 5_000_000;
const cssCache = new Map(); // url -> css text (small LRU)

async function fetchCss(url) {
  if (!/^https?:\/\//i.test(url)) return null;
  if (cssCache.has(url)) {
    const css = cssCache.get(url);
    cssCache.delete(url);
    cssCache.set(url, css);
    return css;
  }
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) return null;
  const type = res.headers.get('content-type') ?? '';
  if (type && !/css|text\/plain/i.test(type)) return null;
  const css = await res.text();
  if (css.length > MAX_CSS_BYTES) return null;
  cssCache.set(url, css);
  if (cssCache.size > 80) cssCache.delete(cssCache.keys().next().value);
  return css;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'aoi:fetch-css' || !sender.tab) return false;
  fetchCss(msg.url).then(sendResponse, () => sendResponse(null));
  return true; // async response
});

// No defaults are written on install: Aoi.loadSettings() fills in any missing
// key at read time, so new settings need no migration.

const BADGE = { off: 'off', recipes: 'rcp', bluescale: 'blue', images: 'img' };
let badgeTimer = null;

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'cycle-mode') return;
  tab ??= (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.url || !/^https?:/i.test(tab.url)) return;

  const host = Aoi.siteKey(new URL(tab.url).hostname);
  const settings = await Aoi.loadSettings();
  const current = Aoi.modeFor(settings, host);
  const next = Aoi.MODES[(Aoi.MODES.indexOf(current) + 1) % Aoi.MODES.length];
  if (!settings.enabled) await Aoi.saveSettings({ enabled: true });
  await Aoi.setSiteMode(host, next);

  // Flash the new mode on the toolbar icon.
  await chrome.action.setBadgeBackgroundColor({ color: '#4c7ad3', tabId: tab.id });
  await chrome.action.setBadgeText({ text: BADGE[next], tabId: tab.id });
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 1600);
});

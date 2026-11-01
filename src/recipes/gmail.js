// Gmail recipe: every label gets its own blue, picked from the label's name, so
// a label has the same colour in the inbox, in an open conversation and in the
// sidebar. Works for labels with and without a Gmail colour.
//
// Gmail's class names are minified. The ones used here come from Gmail's
// long-standing label markup (div.ar.as > div.at > div.au > div.av, which
// InboxSDK also reproduces) and from attributes verified on Gmail in mid-2026
// (sidebar links to #label/..., the per-label aria-labels in an open
// conversation). Not yet checked against a live inbox from this project.
(() => {
  const Aoi = (globalThis.Aoi ??= {});

  const SEARCH_LABEL = 'Search for all messages with label ';

  // "#label/Work%2FClients+2026" -> "Work/Clients 2026"
  function labelFromHref(href) {
    const i = href.indexOf('#label/');
    if (i < 0) return null;
    try {
      return decodeURIComponent(href.slice(i + 7).replace(/\+/g, ' '));
    } catch {
      return null;
    }
  }

  // The coloured label icon next to a sidebar label. Only touched when Gmail
  // itself paints it (inline colour), so plain outline icons are left alone.
  function sidebarIcon(link) {
    const row = link.closest('.TO, .aim, [role="listitem"], li');
    const icon = row?.querySelector('.qj');
    if (!icon) return null;
    return icon.style.backgroundColor || icon.style.borderColor ? icon : null;
  }

  (Aoi.recipes ??= []).push({
    id: 'gmail',
    name: 'Gmail',
    description: 'Every label gets its own blue, the same everywhere',
    match: (host) => host === 'mail.google.com',
    css: `
  /* Label chips: round off Gmail's square-ish chip and let the tone show. */
  [data-aoi-part~="chip"] {
    border-radius: 6px !important;
  }`,
    live: [
      // Label chips in the message list (and anywhere Gmail uses its classic chip)
      {
        selector: '.ar.as > .at',
        name: (el) => el.getAttribute('title') || el.querySelector('.av')?.textContent,
        parts: [
          [null, 'chip'],
          ['.au', 'border'],
          ['.av', 'text'],
        ],
      },
      // Label chips at the top of an open conversation (English Gmail)
      {
        selector: `[aria-label^="${SEARCH_LABEL}"]`,
        name: (el) => el.getAttribute('aria-label').slice(SEARCH_LABEL.length),
        parts: [[null, 'chip']],
      },
      // Coloured label icons in the sidebar
      {
        selector: 'a[href*="#label/"]',
        name: (el) => labelFromHref(el.getAttribute('href') ?? ''),
        parts: [[sidebarIcon, 'icon']],
      },
    ],
  });
})();

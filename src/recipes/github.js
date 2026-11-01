// GitHub recipe: contribution graph, commit-activity bars, language colours,
// activity overview, primary buttons and the active tab underline.
// Graph and buttons are Primer CSS variables on <html>; language colours and
// activity bars are inline styles, recoloured by live rules.
// Selectors checked against github.com in November 2026.
(() => {
  const Aoi = (globalThis.Aoi ??= {});

  const light = `
    --contribution-default-bgColor-0: color-mix(in oklch, var(--aoi-frost) 30%, #f3f5f8) !important;
    --contribution-default-bgColor-1: var(--aoi-frost) !important;
    --contribution-default-bgColor-2: var(--aoi-cornflower) !important;
    --contribution-default-bgColor-3: var(--aoi-blue) !important;
    --contribution-default-bgColor-4: var(--aoi-ink) !important;
    --contribution-default-borderColor-0: rgb(41 67 140 / 0.06) !important;`;

  const dark = `
    --contribution-default-bgColor-0: color-mix(in oklch, var(--aoi-ink) 35%, #151b23) !important;
    --contribution-default-bgColor-1: var(--aoi-ink) !important;
    --contribution-default-bgColor-2: var(--aoi-blue) !important;
    --contribution-default-bgColor-3: var(--aoi-cornflower) !important;
    --contribution-default-bgColor-4: var(--aoi-frost) !important;
    --contribution-default-borderColor-0: rgb(193 224 255 / 0.05) !important;`;

  // Seasonal graphs (Halloween, winter) follow the normal ramp.
  const seasonal = ['halloween', 'winter']
    .flatMap((s) =>
      [1, 2, 3, 4].map(
        (n) => `--contribution-${s}-bgColor-${n}: var(--contribution-default-bgColor-${n}) !important;`,
      ),
    )
    .join('\n    ');

  const accents = `
    --button-primary-bgColor-rest: var(--aoi-blue) !important;
    --button-primary-bgColor-hover: var(--aoi-cobalt) !important;
    --button-primary-bgColor-active: var(--aoi-ink) !important;
    --button-primary-bgColor-disabled: var(--aoi-sky) !important;
    --button-primary-borderColor-disabled: var(--aoi-sky) !important;
    --underlineNav-borderColor-active: var(--aoi-cornflower) !important;`;

  const darkThemes = `[data-color-mode="dark"][data-dark-theme^="dark"],
  [data-color-mode="light"][data-light-theme^="dark"]`;

  (Aoi.recipes ??= []).push({
    id: 'github',
    name: 'GitHub',
    description: 'Contribution graph and activity, language colours, primary buttons, tab underlines',
    match: (host) => host === 'github.com' || host.endsWith('.github.com'),
    css: `
  :root, [data-color-mode] {${light}
    ${seasonal}${accents}
  }
  ${darkThemes} {${dark}
  }
  @media (prefers-color-scheme: dark) {
    [data-color-mode="auto"][data-dark-theme^="dark"] {${dark}
    }
  }
  @media (prefers-color-scheme: light) {
    [data-color-mode="auto"][data-light-theme^="dark"] {${dark}
    }
  }
  /* Activity overview cross chart */
  .js-highlight-blob {
    fill: var(--aoi-cornflower) !important;
    stroke: var(--aoi-cornflower) !important;
  }`,
    live: [
      // Commit-activity bars ("Created 25 commits in 2 repositories") and older language bars
      { selector: '.Progress-item[style*="background"]', recolor: ['background-color'] },
      // Language colour dots on repository lists and cards
      { selector: '.repo-language-color, [class*="languageDot"]', recolor: ['background-color'] },
      // Language bar on a repository page
      { selector: '[class*="ProgressBarItem"]', recolor: ['background-color', '--progress-bg'] },
      // Language list dots under the bar
      { selector: 'svg.octicon-dot-fill[style*="color"]', recolor: ['color'] },
    ],
  });
})();

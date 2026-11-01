// YouTube recipe: the red progress bars, play-head, logo and brand-red accents.
// Class names checked against youtube.com in November 2026.
(() => {
  const Aoi = (globalThis.Aoi ??= {});

  const progress = [
    '.ytp-play-progress',
    '.ytChapteredProgressBarChapteredPlayerBarChapterSeen',
    '.ytChapteredProgressBarChapteredPlayerBarFill',
    '.ytFocusedChapterProgressBarLineProgressBarPlayed',
    '.ytProgressBarLineProgressBarPlayed',
    '.ytwThumbnailOverlayResumePlaybackRendererThumbnailOverlayResumePlaybackProgress',
    '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment',
    '#progress.yt-page-navigation-progress',
  ].join(',\n  ');

  (Aoi.recipes ??= []).push({
    id: 'youtube',
    name: 'YouTube',
    description: 'Progress bars, play-head, logo and brand red',
    match: (host) => host === 'youtube.com' || host.endsWith('.youtube.com'),
    css: `
  html, [light] {
    --aoi-yt-progress: linear-gradient(90deg, var(--aoi-blue) 70%, var(--aoi-sky));
    --yt-sys-color-baseline--static-brand-red: var(--aoi-blue) !important;
    --yt-sys-color-baseline--brand-red-contrast: var(--aoi-cobalt) !important;
    --unified-seek-progress-color: var(--aoi-yt-progress) !important;
  }
  html[dark], [dark] {
    --yt-sys-color-baseline--brand-red-contrast: var(--aoi-sky) !important;
  }
  ${progress} {
    background: var(--aoi-yt-progress) !important;
  }
  .ytProgressBarPlayheadProgressBarPlayheadDot,
  .ytp-swatch-background-color {
    background-color: var(--aoi-blue) !important;
  }
  .ytp-swatch-color {
    color: var(--aoi-blue) !important;
  }
  svg path[fill="#ff0033" i],
  svg path[fill="#f03" i],
  svg path[fill="#ff0000" i],
  svg path[fill="red" i] {
    fill: var(--aoi-blue) !important;
  }`,
  });
})();

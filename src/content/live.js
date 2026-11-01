// Live recipe rules: recipe work that plain CSS can't do because the colour
// depends on each element.
//
// A recipe can list `live` rules of two kinds:
//
//   Tone by name: every distinct name gets its own palette tone, always the
//   same one (mail labels, tags). The element and its parts are tagged with
//   data-aoi-tone / data-aoi-part, and one generated stylesheet colours them,
//   so the site re-rendering its own inline colours doesn't fight us.
//     { selector, name: (el) => string, parts: [[target, part], ...] }
//       target: null (the element), a selector inside it, or (el) => element
//       part:   'chip' | 'text' | 'border' | 'icon'
//
//   Recolour: the element's own inline colour goes through the bluescale
//   transform (language dots, bars). Similar colours stay similar.
//     { selector, recolor: ['background-color', 'color', ...] }
//
// stop() removes every tag and puts every inline colour back.
(() => {
  const Aoi = globalThis.Aoi;

  const PART_CSS = {
    chip: (t) => `background-color: ${t.bg} !important; border-color: ${t.border} !important; color: ${t.fg} !important;`,
    text: (t) => `color: ${t.fg} !important;`,
    border: (t) => `border-color: ${t.bg} !important;`,
    icon: (t) => `background-color: ${t.bg} !important; border-color: ${t.bg} !important;`,
  };

  class Live {
    constructor() {
      this.active = false;
    }

    // ctx: { mapper, tones, memory: { names: {name: toneIndex}, save() } }
    start(rules, ctx) {
      this.stop();
      if (!rules.length) return;
      this.active = true;
      this.rules = rules;
      this.ctx = ctx;
      this.selector = rules.map((r) => r.selector).join(',');
      this.recolored = new WeakMap(); // element -> Map(prop -> [original, priority, written])

      this.style = document.createElement('style');
      this.style.setAttribute('data-aoi', 'live');
      this.style.textContent = ctx.tones
        .flatMap((tone, i) =>
          Object.entries(PART_CSS).map(
            ([part, css]) => `[data-aoi-tone="${i}"][data-aoi-part~="${part}"] { ${css(tone)} }`,
          ),
        )
        .join('\n');
      (document.head ?? document.documentElement).appendChild(this.style);
      this.onReady = () => this.style?.isConnected && document.head?.appendChild(this.style);
      document.addEventListener('DOMContentLoaded', this.onReady, { once: true });

      this.observer = new MutationObserver((records) => this.onMutations(records));
      this.observer.observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'title', 'aria-label', 'href'],
      });
      this.scan(document);
    }

    stop() {
      if (!this.active) return;
      this.active = false;
      this.observer.disconnect();
      document.removeEventListener('DOMContentLoaded', this.onReady);
      this.style.remove();
      for (const el of document.querySelectorAll('[data-aoi-tone], [data-aoi-part]')) {
        el.removeAttribute('data-aoi-tone');
        el.removeAttribute('data-aoi-part');
      }
      for (const el of document.querySelectorAll('[data-aoi-live]')) {
        const rec = this.recolored.get(el);
        if (rec) {
          for (const [prop, [orig, priority, written]] of rec) {
            if (el.style.getPropertyValue(prop) === written) el.style.setProperty(prop, orig, priority);
          }
        }
        el.removeAttribute('data-aoi-live');
      }
    }

    scan(root) {
      if (root.nodeType === 1 && root.matches(this.selector)) this.process(root);
      for (const el of root.querySelectorAll(this.selector)) this.process(el);
    }

    onMutations(records) {
      for (const r of records) {
        if (r.type === 'attributes') {
          const el = r.target;
          if (el.matches?.(this.selector)) this.process(el);
          continue;
        }
        for (const node of r.addedNodes) {
          if (node.nodeType !== 1) continue;
          this.scan(node);
          // A site may rebuild only the inside of a chip we already tagged.
          const host = node.parentElement?.closest(this.selector);
          if (host) this.process(host);
        }
      }
    }

    process(el) {
      for (const rule of this.rules) {
        if (!el.matches(rule.selector)) continue;
        try {
          if (rule.recolor) this.recolor(el, rule.recolor);
          else this.tone(el, rule);
        } catch (err) {
          console.warn('[aoi]', err);
        }
      }
    }

    // A name keeps the tone it was first given (remembered per site in
    // ctx.memory). New names take the least-used tone, so the first ten
    // labels all get different blues; ties go to the name's hash slot.
    toneFor(name) {
      const key = name.toLowerCase();
      const { names } = this.ctx.memory;
      const n = this.ctx.tones.length;
      if (Number.isInteger(names[key]) && names[key] < n) return names[key];
      const used = new Array(n).fill(0);
      for (const i of Object.values(names)) if (i < n) used[i]++;
      const start = Aoi.color.hashString(key) % n;
      let best = start;
      for (let k = 1; k < n; k++) {
        const i = (start + k) % n;
        if (used[i] < used[best]) best = i;
      }
      names[key] = best;
      this.ctx.memory.save();
      return best;
    }

    tone(el, rule) {
      const name = rule.name(el)?.trim();
      if (!name) return;
      const index = String(this.toneFor(name));
      for (const [target, part] of rule.parts) {
        const node = !target ? el : typeof target === 'function' ? target(el) : el.querySelector(target);
        if (!node) continue;
        if (node.getAttribute('data-aoi-tone') !== index) node.setAttribute('data-aoi-tone', index);
        const parts = new Set((node.getAttribute('data-aoi-part') ?? '').split(' ').filter(Boolean));
        if (!parts.has(part)) {
          parts.add(part);
          node.setAttribute('data-aoi-part', [...parts].join(' '));
        }
      }
    }

    recolor(el, props) {
      let rec = this.recolored.get(el);
      for (const prop of props) {
        const value = el.style.getPropertyValue(prop);
        if (!value || rec?.get(prop)?.[2] === value) continue; // empty, or still ours
        const next = this.ctx.mapper.value(prop, value);
        if (next === value) continue;
        const priority = el.style.getPropertyPriority(prop);
        el.style.setProperty(prop, next, 'important');
        (rec ??= new Map()).set(prop, [value, priority, el.style.getPropertyValue(prop)]);
      }
      if (rec) {
        this.recolored.set(el, rec);
        if (!el.hasAttribute('data-aoi-live')) el.setAttribute('data-aoi-live', '');
      }
    }
  }

  Aoi.Live = Live;
})();

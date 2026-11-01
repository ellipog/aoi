// Bluescale engine: recolours any page by rewriting the colours inside its CSS.
//
// It edits the page's own CSS rules in place (the way Dark Reader's dynamic
// mode does), so selectors, specificity and cascade order stay exactly as the
// site wrote them. It covers:
//   - stylesheets, including ones added later and rules inserted by CSS-in-JS,
//   - cross-origin stylesheets, fetched through the background worker,
//   - inline style="" attributes and SVG/legacy colour attributes,
//   - open shadow roots and their adopted stylesheets.
// Every change is recorded, so stop() puts the page back exactly as it was.
(() => {
  const Aoi = globalThis.Aoi;

  // Longhand properties that can hold a colour (custom properties are checked separately).
  const COLOR_PROP_RE =
    /(?:^|-)color$|^(?:background-image|box-shadow|text-shadow|fill|stroke|border-image-source|filter)$/;
  const isColorProp = (p) => (p.charCodeAt(0) === 45 && p.charCodeAt(1) === 45) || COLOR_PROP_RE.test(p);

  const ATTRS = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'bgcolor', 'color'];
  const ATTR_SELECTOR = '[fill],[stroke],[stop-color],[flood-color],[lighting-color],[bgcolor],font[color]';
  const OBSERVE = {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['style', ...ATTRS],
  };

  // Our own <style> elements (recipes, duotone) carry data-aoi and are skipped.
  const isOwn = (node) => node?.nodeType === 1 && node.hasAttribute('data-aoi');

  // Cross-origin CSS is copied into a <style>; its relative URLs must keep
  // pointing at the original location.
  function absolutize(css, base) {
    const abs = (u) => {
      try {
        return new URL(u, base).href;
      } catch {
        return null;
      }
    };
    return css
      .replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (m, q, u) => {
        if (!u || /^(?:data:|#|[a-z][\w+.-]*:)/i.test(u.trim())) return m;
        const href = abs(u.trim());
        return href ? `url("${href}")` : m;
      })
      .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => {
        const href = abs(u);
        return href ? `@import "${href}"` : m;
      });
  }

  class Engine {
    constructor() {
      this.active = false;
    }

    start(opts) {
      this.stop();
      this.active = true;
      this.mapper = new Aoi.color.Mapper(opts);
      this.patches = []; // CSS rule edits, for undo
      this.seen = new WeakSet(); // CSSRules already handled
      this.counts = new WeakMap(); // sheet -> rule count when last handled
      this.blocked = new WeakSet(); // sheets we can't read (cross-origin)
      this.proxies = new Map(); // <link> -> readable <style> copy
      this.inline = new WeakMap(); // element -> inline-style edits
      this.attrEdits = new WeakMap(); // element -> attribute edits
      this.roots = new Set();

      this.observer = new MutationObserver((records) => this.onMutations(records));
      this.onLoad = (e) => {
        if (e.target?.nodeName === 'LINK' || e.target?.nodeName === 'STYLE') this.scanSheets();
      };
      document.addEventListener('load', this.onLoad, true);

      // CSS-in-JS libraries add rules with insertRule(), which no DOM event
      // reports. Most of those come with a DOM change (caught by the observer);
      // this slow timer catches the rest. Shadow roots that appear when custom
      // elements upgrade late are picked up by a few early sweeps.
      this.timer = setInterval(() => this.scanSheets(), 1000);
      this.sweeps = [1500, 4000, 9000].map((ms) => setTimeout(() => this.sweep(), ms));
      this.onReady = () => this.sweep();
      document.addEventListener('DOMContentLoaded', this.onReady);
      window.addEventListener('load', this.onReady);

      this.addRoot(document);
    }

    stop() {
      if (!this.active) return;
      this.active = false;
      this.observer.disconnect();
      clearInterval(this.timer);
      for (const t of this.sweeps) clearTimeout(t);
      document.removeEventListener('load', this.onLoad, true);
      document.removeEventListener('DOMContentLoaded', this.onReady);
      window.removeEventListener('load', this.onReady);

      for (let i = this.patches.length - 1; i >= 0; i--) {
        const p = this.patches[i];
        try {
          p.style.setProperty(p.prop, p.value, p.priority);
        } catch {
          // the rule's sheet is gone, nothing to undo
        }
      }

      for (const [link, style] of this.proxies) {
        style?.remove();
        if (link.sheet) link.sheet.disabled = false;
      }

      for (const root of this.roots) {
        for (const el of root.querySelectorAll('[style]')) this.restoreInline(el);
        for (const el of root.querySelectorAll(ATTR_SELECTOR)) this.restoreAttrs(el);
      }

      this.patches = [];
      this.proxies = new Map();
      this.roots = new Set();
    }

    // ------------------------------------------------------------ roots & sweeps

    addRoot(root) {
      if (this.roots.has(root)) return;
      this.roots.add(root);
      this.observer.observe(root, OBSERVE);
      this.processTree(root);
      this.scanRoot(root);
    }

    sweep() {
      if (!this.active) return;
      this.findShadowRoots(document);
      this.scanSheets();
    }

    findShadowRoots(node) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
      for (let el = walker.currentNode; el; el = walker.nextNode()) {
        if (el.shadowRoot && !this.roots.has(el.shadowRoot)) this.addRoot(el.shadowRoot);
      }
    }

    processTree(node) {
      if (node.nodeType === 1) {
        if (node.hasAttribute('style')) this.processInline(node);
        if (node.matches(ATTR_SELECTOR)) this.processAttrs(node);
      }
      if (!node.querySelectorAll) return;
      for (const el of node.querySelectorAll('[style]')) this.processInline(el);
      for (const el of node.querySelectorAll(ATTR_SELECTOR)) this.processAttrs(el);
      this.findShadowRoots(node);
    }

    onMutations(records) {
      if (!this.active) return;
      let structural = false;
      for (const r of records) {
        if (r.type === 'attributes') {
          if (r.attributeName === 'style') this.processInline(r.target);
          else this.processAttrs(r.target);
        } else if (r.type === 'childList') {
          structural = true;
          for (const n of r.addedNodes) if (n.nodeType === 1) this.processTree(n);
          for (const n of r.removedNodes) if (n.nodeName === 'LINK') this.dropProxy(n);
        } else if (r.target.parentNode?.nodeName === 'STYLE') {
          structural = true;
        }
      }
      if (structural) this.scanSheets();
    }

    // ------------------------------------------------------------ stylesheets

    scanSheets() {
      if (!this.active) return;
      for (const root of this.roots) {
        if (root !== document && !root.host.isConnected) {
          this.roots.delete(root); // re-added if the host comes back
          continue;
        }
        this.scanRoot(root);
      }
    }

    scanRoot(root) {
      for (const sheet of root.styleSheets) this.checkSheet(sheet);
      const adopted = root.adoptedStyleSheets;
      if (adopted) for (const sheet of adopted) this.checkSheet(sheet);
    }

    checkSheet(sheet) {
      if (!sheet || this.blocked.has(sheet) || isOwn(sheet.ownerNode)) return;
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        this.blocked.add(sheet);
        this.proxy(sheet);
        return;
      }
      const n = rules.length;
      // Unchanged if the count matches and both ends are rules we've seen
      // (replaceSync() can swap every rule while keeping the count).
      if (this.counts.get(sheet) === n && (n === 0 || (this.seen.has(rules[0]) && this.seen.has(rules[n - 1])))) {
        return;
      }
      this.counts.set(sheet, n);
      this.processRules(rules);
    }

    processRules(rules) {
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        if (this.seen.has(rule)) continue;
        this.seen.add(rule);
        try {
          if (rule.style) this.processDeclarations(rule.style);
        } catch {
          // An unusual rule type must not stop the rest of the sheet.
        }
        if (rule.cssRules) this.processRules(rule.cssRules); // @media, @supports, @layer, nesting, keyframes
        if (rule.styleSheet) this.checkSheet(rule.styleSheet); // @import
      }
    }

    processDeclarations(style) {
      const changes = this.collect(style);
      if (!changes) return;
      for (let i = 0; i < changes.length; i += 3) {
        const prop = changes[i];
        const priority = style.getPropertyPriority(prop);
        style.setProperty(prop, changes[i + 2], priority);
        this.patches.push({ style, prop, value: changes[i + 1], priority });
      }
    }

    // Returns a flat [prop, oldValue, newValue, ...] list, or null.
    collect(style, skip) {
      let changes = null;
      for (let i = 0; i < style.length; i++) {
        // item() rather than style[i]: some declaration blocks (e.g. @position-try)
        // don't support indexing.
        const prop = style.item(i);
        if (!prop || !isColorProp(prop)) continue;
        const value = style.getPropertyValue(prop);
        if (!value || (skip && skip.get(prop) === value)) continue;
        const next = this.mapper.value(prop, value);
        if (next !== value) (changes ??= []).push(prop, value, next);
      }
      return changes;
    }

    // Cross-origin stylesheets can't be read from the page. The background
    // worker fetches the CSS, a readable <style> copy takes the <link>'s place
    // in the cascade, and the original is switched off.
    async proxy(sheet) {
      const link = sheet.ownerNode;
      if (link?.nodeName !== 'LINK' || !sheet.href || this.proxies.has(link)) return;
      const proxies = this.proxies;
      proxies.set(link, null);
      let css = null;
      try {
        css = await chrome.runtime.sendMessage({ type: 'aoi:fetch-css', url: sheet.href });
      } catch {
        // extension reloaded or worker unavailable
      }
      if (!this.active || proxies !== this.proxies || !css || !link.isConnected || link.sheet !== sheet) return;
      const style = document.createElement('style');
      style.setAttribute('data-aoi-proxy', '');
      if (link.media) style.media = link.media;
      style.textContent = absolutize(css, sheet.href);
      link.after(style);
      sheet.disabled = true;
      proxies.set(link, style);
      this.checkSheet(style.sheet);
    }

    dropProxy(link) {
      const style = this.proxies.get(link);
      if (style === undefined) return;
      style?.remove();
      this.proxies.delete(link);
    }

    // ------------------------------------------------------------ inline styles

    processInline(el) {
      const attr = el.getAttribute('style');
      if (!attr || el.hasAttribute('data-aoi-live')) return; // a live recipe rule owns it
      let rec = this.inline.get(el);
      if (rec && rec.attr === attr) return; // nothing new since we last wrote it
      const changes = this.collect(el.style, rec?.out);
      if (changes) {
        rec ??= { orig: new Map(), out: new Map(), attr: '' };
        for (let i = 0; i < changes.length; i += 3) {
          const prop = changes[i];
          el.style.setProperty(prop, changes[i + 2], el.style.getPropertyPriority(prop));
          rec.orig.set(prop, changes[i + 1]);
          rec.out.set(prop, el.style.getPropertyValue(prop));
        }
        this.inline.set(el, rec);
      }
      if (rec) rec.attr = el.getAttribute('style');
    }

    restoreInline(el) {
      const rec = this.inline.get(el);
      if (!rec) return;
      for (const [prop, value] of rec.orig) {
        // Only undo values that are still ours; the page may have changed them since.
        if (el.style.getPropertyValue(prop) === rec.out.get(prop)) {
          el.style.setProperty(prop, value, el.style.getPropertyPriority(prop));
        }
      }
      this.inline.delete(el);
    }

    // ------------------------------------------------------------ colour attributes

    processAttrs(el) {
      let rec = this.attrEdits.get(el);
      for (const name of ATTRS) {
        if (name === 'color' && el.localName !== 'font') continue;
        const value = el.getAttribute(name);
        if (!value || rec?.get(name)?.[1] === value) continue;
        const next = this.mapper.value('color', value);
        if (next === value) continue;
        (rec ??= new Map()).set(name, [value, next]);
        el.setAttribute(name, next);
      }
      if (rec) this.attrEdits.set(el, rec);
    }

    restoreAttrs(el) {
      const rec = this.attrEdits.get(el);
      if (!rec) return;
      for (const [name, [orig, out]] of rec) {
        if (el.getAttribute(name) === out) el.setAttribute(name, orig);
      }
      this.attrEdits.delete(el);
    }
  }

  Aoi.Engine = Engine;
})();

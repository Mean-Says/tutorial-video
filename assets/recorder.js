// tutorial-video recorder: paste this whole file into javascript_tool. Idempotent; re-run after every full page load.
// Logs WHERE and WHEN things happen (never typed characters) so the editor can draw the cursor, zooms and callouts.
(() => {
  if (window.__tut && window.__tut.v === 2) return 'tut:ok (já injetado)';
  const KEY = '__tut_events';
  let ss = null;
  try { ss = window.sessionStorage; } catch {}
  let buf = [];
  try { buf = JSON.parse((ss && ss.getItem(KEY)) || '[]'); } catch {}
  const save = () => { try { ss && ss.setItem(KEY, JSON.stringify(buf)); } catch {} };
  // Viewport size and URL are only stored when they matter, to keep dumps small.
  let lastVw = 0; let lastVh = 0;
  const push = (e) => {
    e.t = Date.now();
    if (innerWidth !== lastVw || innerHeight !== lastVh || e.type === 'inject' || e.type === 'flash') {
      e.vw = lastVw = innerWidth; e.vh = lastVh = innerHeight;
    }
    if (e.url === undefined && (e.type === 'nav' || e.type === 'inject' || e.type === 'flash')) e.url = location.href;
    buf.push(e); save(); return e;
  };
  const R = (el) => {
    if (!el || !el.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    return [r.left, r.top, r.width, r.height].map(Math.round);
  };
  const ACT = 'a,button,input,select,textarea,label,summary,[role=button],[role=link],[role=menuitem],[role=tab],[role=option],[role=checkbox],[role=switch],[contenteditable=""],[contenteditable=true]';
  const pick = (el) => (el && el.closest && el.closest(ACT)) || el;
  const lab = (el) => ((el && (el.getAttribute && el.getAttribute('aria-label') || el.innerText || el.placeholder || el.name)) || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  const on = (type, fn) => addEventListener(type, fn, true);
  const every = (ms, fn) => { let last = 0; return (e) => { const n = performance.now(); if (n - last >= ms) { last = n; fn(e); } }; };

  on('pointerdown', (e) => { const el = pick(e.target); push({ type: 'click', x: Math.round(e.clientX), y: Math.round(e.clientY), rect: R(el), label: lab(el) }); });
  on('pointermove', every(120, (e) => push({ type: 'move', x: Math.round(e.clientX), y: Math.round(e.clientY) })));
  on('keydown', (e) => {
    if (['Shift', 'Meta', 'Control', 'Alt', 'CapsLock'].includes(e.key)) return;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) return; // plain typing: characters are never logged
    const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && e.key.length > 1 && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
    push({ type: 'key', key: [...mods, e.key].join('+') });
  });
  on('input', every(250, (e) => push({ type: 'input', rect: R(e.target) })));
  on('scroll', every(300, () => push({ type: 'scroll' })));
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function (...a) { const r = orig.apply(this, a); push({ type: 'nav' }); return r; };
  }
  on('popstate', () => push({ type: 'nav' }));
  addEventListener('pagehide', () => push({ type: 'nav', url: '' }));

  const find = (target) => {
    if (target && typeof target === 'object' && 'x' in target) return document.elementFromPoint(target.x, target.y);
    const s = String(target);
    if (/^[#.[]|[>:=]/.test(s)) { try { const el = document.querySelector(s); if (el) return el; } catch {} }
    const want = s.trim().toLowerCase();
    let best = null; let score = Infinity;
    for (const el of document.querySelectorAll('body *')) {
      const txt = (el.innerText || (el.getAttribute && el.getAttribute('aria-label')) || el.placeholder || '').trim().toLowerCase();
      if (!txt) continue;
      const rank = txt === want ? 0 : txt.includes(want) ? 1 : -1;
      if (rank < 0) continue;
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (!area || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
      const sc = rank * 1e9 + area;
      if (sc < score) { score = sc; best = el; }
    }
    return best;
  };

  const flash = (ms = 500) => new Promise((resolve) => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;background:#ff00ff;z-index:2147483647;pointer-events:none';
    (document.body || document.documentElement).appendChild(d);
    let done = false;
    const fallback = setTimeout(() => {
      if (done) return; done = true; d.remove(); push({ type: 'flash-failed' });
      resolve('flash-failed: a aba não está visível (traga a janela para frente)');
    }, 2000);
    requestAnimationFrame(() => {
      if (done) return; done = true; clearTimeout(fallback); push({ type: 'flash' });
      setTimeout(() => { d.remove(); resolve('flash ok'); }, ms);
    });
  });

  const api = {
    v: 2,
    flash,
    mark: (name) => { push({ type: 'mark', name }); return 'mark ' + name; },
    callout: (target, label, dur) => {
      const el = find(target);
      if (!el) return 'callout: não achei ' + JSON.stringify(target);
      const rect = R(el);
      push({ type: 'callout', rect, label, dur });
      return { rect, text: lab(el) };
    },
    type: async (text, cps = 14) => {
      const el = document.activeElement;
      if (!el || !(el.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName))) return 'type: nenhum campo focado (clique no campo antes)';
      for (const ch of String(text)) {
        document.execCommand('insertText', false, ch);
        await new Promise((r) => setTimeout(r, (1000 / cps) * (0.6 + Math.random() * 0.8)));
      }
      return 'typed ' + String(text).length;
    },
    scrollTo: (target) => {
      const el = find(target);
      if (!el) return 'scrollTo: não achei ' + JSON.stringify(target);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return 'ok';
    },
    info: () => ({ iw: innerWidth, ih: innerHeight, ow: outerWidth, oh: outerHeight, sx: screenX, sy: screenY, aw: screen.availWidth, ah: screen.availHeight, dpr: devicePixelRatio, visible: document.visibilityState, url: location.href }),
    windowPlan: (vw, vh) => {
      const cw = outerWidth - innerWidth; const chH = outerHeight - innerHeight;
      const W = vw + cw; const H = vh + chH;
      const aw = screen.availWidth; const ah = screen.availHeight;
      const al = screen.availLeft || 0; const at = screen.availTop || 0;
      if (W > aw || H > ah) return { error: 'não cabe na tela', max: { vw: aw - cw, vh: ah - chH } };
      const l = Math.round(al + (aw - W) / 2); const t = Math.round(at + (ah - H) / 2);
      const marker = 'TUT' + Math.random().toString(36).slice(2, 8);
      api._title = document.title; document.title = marker + ' ' + document.title;
      return { marker, bounds: [l, t, l + W, t + H] };
    },
    untitle: () => { if (api._title !== undefined) document.title = api._title; return 'ok'; },
    // Preferred: puts the events on the clipboard so they can be saved with `pbpaste` (no transcription).
    copy: async () => {
      const n = buf.length;
      try { await navigator.clipboard.writeText(JSON.stringify(buf)); } catch (err) { return 'clipboard-failed (' + err.name + '): use __tut.dump()'; }
      buf = []; save(); return 'copied ' + n + ' events';
    },
    dump: () => { const out = JSON.stringify(buf); buf = []; save(); return out; },
    count: () => buf.length,
  };
  window.__tut = api;
  push({ type: 'inject' });
  return 'tut:ok';
})();

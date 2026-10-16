// Mathsodon — one formula, its square-symmetry copies, on a canvas. Plan v0.3, milestone 2b.
const APP = 'Mathsodon';
const SITE = 'https://mathsodon.com/';   // the web build (GitHub Pages from the public mathsodon-site repo); stamped links from the apps point here

// ---------- formula → closure (no eval, no new Function) ----------
const CONST = new Map([['pi', Math.PI], ['e', Math.E]]);
const FN = new Map('sin cos tan asin acos atan sinh cosh tanh exp sqrt abs floor ceil round sign min max'
  .split(' ').map(n => [n, Math[n]]));
FN.set('ln', Math.log); FN.set('log', Math.log10);

// Names are matched longest first, else one letter, so kx = k·x and xsin(x) = x·sin(x) (the Desmos rule).
const NAMES = [...FN.keys(), ...CONST.keys()].sort((a, b) => b.length - a.length).join('|');
const TOK = new RegExp(`(\\d*\\.?\\d+)|(${NAMES}|[a-zA-Z])|([-+*/^(),])|(\\s+)`, 'gy');
function tokenize(src) {
  const out = []; let end = 0;
  for (const m of src.matchAll(TOK)) {
    end = m.index + m[0].length;
    if (!m[4]) out.push(m[1] != null ? { n: +m[1] } : m[2] != null ? { id: m[2], i0: m.index, i1: end } : { op: m[3] });
  }
  if (end < src.length) throw Error(`Unexpected "${src[end]}"`);
  return out;
}

// Pratt parser emitting closures (x, a, v) → number. Numbers become a[k] and single letters v[name],
// so sliders never recompile.
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };
const OPS = { '+': (p, q) => p + q, '-': (p, q) => p - q, '*': (p, q) => p * q, '/': (p, q) => p / q, '^': Math.pow };
const bin = (g, l, r) => (x, a, v) => g(l(x, a, v), r(x, a, v));
function parse(toks, consts, vars) {
  let p = 0;
  const peek = () => toks[p], next = () => toks[p++];
  const expect = op => { const t = next(); if (!t || t.op !== op) throw Error(`Expected "${op}"`); };
  function prim() {
    const t = next();
    if (!t) throw Error('Unexpected end');
    if (t.n != null) { const k = consts.push(t.n) - 1; return (x, a) => a[k]; }
    if (t.op === '(') { const e = expr(0); expect(')'); return e; }
    if (t.op === '-') { const e = expr(3); return (x, a, v) => -e(x, a, v); }   // -x^2 = -(x^2), -x*2 = (-x)*2
    if (t.op === '+') return expr(3);
    if (t.id) {
      if (t.id === 'x') return x => x;
      if (CONST.has(t.id)) { const c = CONST.get(t.id); return () => c; }
      if (FN.has(t.id)) {
        const fn = FN.get(t.id); expect('(');
        const args = [expr(0)];
        while (peek()?.op === ',') { next(); args.push(expr(0)); }
        expect(')');
        if (fn.length === 1 && args.length !== 1) throw Error(`${t.id} takes one argument`);   // min/max stay variadic
        return (x, a, v) => fn(...args.map(e => e(x, a, v)));
      }
      const n = t.id; vars.add(n); return (x, a, v) => v[n];   // anything else the tokenizer lets through is a single letter
    }
    throw Error(`Unexpected "${t.op}"`);
  }
  function expr(min) {
    let l = prim();
    for (let t; (t = peek());) {
      const op = t.op, pr = PREC[op];
      if (pr == null) {                                   // implicit multiplication: 7x, 2(x+1), x cos(x)
        if (t.n == null && !t.id && op !== '(') break;    // ')' or ','
        if (2 < min) break;
        l = bin(OPS['*'], l, expr(3));
        continue;
      }
      if (pr < min) break;
      next();
      l = bin(OPS[op], l, expr(op === '^' ? 4 : pr + 1));   // ^ right-assoc, others left
    }
    return l;
  }
  const f = expr(0);
  if (p < toks.length) throw Error(`Unexpected "${toks[p].op ?? toks[p].id ?? toks[p].n}"`);
  return f;
}

function compile(src) {
  src = src.trim();
  const toks = tokenize(src);
  if (!toks.length) throw Error('Type a formula');
  const consts = [], vars = new Set(), f = parse(toks, consts, vars);
  // parts = the text between numbers, so sliders can rewrite the formula; digits only ever occur in numbers
  return { f, consts, parts: src.split(/\d*\.?\d+/), varNames: [...vars], usesX: toks.some(t => t.id === 'x') };
}
const fmt = v => String(+v.toFixed(3));
// ponytail: a constant dragged negative is written back as (−v) so the text means what is drawn; re-parsing it yields an unsigned slider again
const join = (parts, consts) => parts.map((p, j) => j < consts.length ? p + (consts[j] < 0 ? `(${fmt(consts[j])})` : fmt(consts[j])) : p).join('');
function shifted(src, name) {                             // f(x) → f(x − name): the one-tap parity fix
  let out = '', last = 0;
  for (const t of tokenize(src)) if (t.id === 'x') { out += src.slice(last, t.i0) + `(x-${name})`; last = t.i1; }
  return out + src.slice(last);
}

// ---------- symmetries: D_n as 2×2 matrices [a, b, c, d], (x, y) → (ax + by, cx + dy) ----------
const r9 = v => Math.round(v * 1e9) / 1e9 + 0;            // + 0 turns −0 into 0
function dihedral(n) {                                    // n rotations by 2πk/n, then n reflections across lines at angle πk/n
  const m = [];
  for (let k = 0; k < n; k++) { const c = r9(Math.cos(2 * Math.PI * k / n)), s = r9(Math.sin(2 * Math.PI * k / n)); m.push([c, -s, s, c]); }
  for (let k = 0; k < n; k++) { const c = r9(Math.cos(2 * Math.PI * k / n)), s = r9(Math.sin(2 * Math.PI * k / n)); m.push([c, s, s, -c]); }
  return m.map(row => row.map(r9));
}
const D4 = dihedral(4), ORDER4 = [0, 4, 5, 3, 6, 2, 1, 7]; // generated order → plan table rows 1..8
const T = ORDER4.map(i => D4[i]);                         // ponytail: n fixed at 4 in 1.0; N-fold is a Studio feature
const key = m => m.map(r9).join(',');
const INDEX = new Map(T.map((m, k) => [key(m), k]));
const mul = ([a, b, c, d], [e, f, g, h]) => [a * e + b * g, a * f + b * h, c * e + d * g, c * f + d * h];   // A·B: apply B, then A
function closure(gens) {                                  // the subgroup they generate, as sorted T indices (identity always in)
  const set = new Set([0]);                               // a Set iterator visits entries added mid-loop, so this walks every product of generators
  for (const i of set) for (const g of gens) set.add(INDEX.get(key(mul(T[i], T[g]))));
  return [...set].sort((p, q) => p - q);
}
const LABELS = ['as drawn', 'flip ↕\uFE0E', 'flip y=x', 'turn 90° ↻', 'flip ↔\uFE0E', 'turn 180°', 'turn 90° ↺', 'flip y=−x'];
const PRESETS = [['none', []], ['mirror ↕\uFE0E', [1]], ['mirror ↔\uFE0E', [4]], ['4-way mirror', [1, 4]], ['pinwheel', [6]], ['kaleidoscope', [1, 6]]]
  .map(([name, gens]) => ({ name, gens, on: closure(gens) }));
// Parity: an even f is invariant under flip ↔ (row 5), an odd f under turn 180° (row 6), so these copies coincide (0-based rows).
const PAIRS = { even: [[0, 4], [1, 5], [2, 3], [6, 7]], odd: [[0, 5], [1, 4], [2, 7], [3, 6]] };

function sample(f, consts, vars, R, N) {                  // f on a grid symmetric about 0, so xs[N−i] = −xs[i]
  const xs = new Float64Array(N + 1), ys = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const y = f(xs[i] = -R + 2 * R * i / N, consts, vars);
    ys[i] = Math.abs(y) < 1e6 ? y : NaN;                  // NaN lifts the pen
  }
  return { xs, ys };
}
// 'even' | 'odd' | null. Matching is judged across the curve at pixel scale (tol in y-units, default ≈ 1 px),
// so near-parity that still looks doubled on screen counts as parity. A larger tol asks for a clearly separated fix.
function parityOf(ys, R, tol = R / 300) {
  const N = ys.length - 1, dx = 2 * R / N;
  let even = true, odd = true, n = 0;
  for (let i = 0; i <= N >> 1; i++) {
    const a = ys[i], b = ys[N - i], na = a !== a, nb = b !== b;
    if (na || nb) { if (na !== nb) return null; continue; }
    n++;
    const slope = i > 0 ? (ys[i + 1] - ys[i - 1]) / (2 * dx) : 0, scale = Math.hypot(1, slope || 0);
    if (Math.abs(a - b) / scale > tol) even = false;
    if (Math.abs(a + b) / scale > tol) odd = false;
    if (!even && !odd) return null;
  }
  return n ? (even ? 'even' : odd ? 'odd' : null) : null;   // no finite samples at all: nothing to say
}

const PALETTES = {
  Spectrum: [0, 45, 90, 135, 180, 225, 270, 315].map(h => [h, 85]),
  Ocean: [165, 180, 195, 210, 225, 240, 255, 270].map(h => [h, 70]),
  Sunset: [[350, 90], [15, 90], [30, 95], [45, 95], [330, 80], [300, 70], [10, 80], [40, 90]],
  Ink: Array(8).fill([0, 0]),
};
// Five without parity (8 distinct copies), four with it (to show the dim + fix).
const STARTERS = ['sin(3x)+cos(5x)/2', 'cos(7x^2+2x)/3', 'x^2/4-x', 'sin(3x)*cos(5x+1)', 'tanh(3x)+sin(5x+1)/3',
  'x*sin(6x)/2', 'tan(2x)/8', 'sqrt(abs(sin(4x)))', 'sin(1/x)/2'];

const G = ['sin', 'cos', 'tanh', 'atan'];                 // bounded only: a pole's branches become lines across the canvas under rotation
function randomPiece(rnd = Math.random) {                 // {src, vars} with clearly separated copies; both branches carry a phase
  const pick = a => a[rnd() * a.length | 0], ri = (lo, hi) => lo + (rnd() * (hi - lo + 1) | 0), rf = (lo, hi) => +(lo + rnd() * (hi - lo)).toFixed(2);
  const starter = rnd() < 0.4 ? pick(STARTERS) : null;
  const g1 = pick(G), g2 = pick(G), k1 = ri(1, 9), k2 = ri(1, 9), a = rf(0.3, 1.5), b = rf(0.3, 1.5), op = pick(['+', '*']);
  let out;
  for (let i = 0; i < 12; i++) {                          // re-roll the phase while the parity check fires
    const p = rf(0.3, 2.8);
    out = starter ? { src: shifted(starter, 'c'), vars: { c: p } } : { src: `${a}${g1}(${k1}x+${p})${op}${b}${g2}(${k2}x)`, vars: {} };
    const c = compile(out.src);
    if (!parityOf(sample(c.f, c.consts, out.vars, 2, 400).ys, 2, 0.1)) break;
  }
  return out;
}

// ---------- self-check: `node app.js --test` ----------
function selfTest() {
  const ok = (c, m) => { if (!c) throw Error('selftest: ' + m); };
  const near = (a, b) => Math.abs(a - b) < 1e-9, eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let c = compile('1/3*cos(7x^2)');
  ok(near(c.f(0, c.consts, {}), 1 / 3) && c.consts.length === 4 && c.usesX, 'basic + implicit mult');
  ok(join(c.parts, [2, 3, 7, 2]) === '2/3*cos(7x^2)' && join(['', '^x'], [-2]) === '(-2)^x', 'slider rewrite');
  ok(near(compile('-x^2').f(3, [2], {}), -9), 'unary minus binds looser than ^');
  ok(near(compile('2^-x').f(1, [2], {}), 0.5), 'unary minus on exponent');
  ok(near(compile('1/2x').f(4, [1, 2], {}), 2), 'implicit mult is left-to-right');
  ok(near(compile('2^3^2').f(0, [2, 3, 2], {}), 512), '^ right-assoc');
  ok(near(compile('(x+1)(x-1)').f(3, [1, 1], {}), 8), 'paren implicit mult');
  ok(near(compile('max(x, pi)').f(1, [], {}), Math.PI), 'two-arg call + constant');
  c = compile('a sin(k x) + b');
  ok(eq(c.varNames, ['a', 'k', 'b']) && near(c.f(1, [], { a: 2, k: Math.PI / 2, b: 1 }), 3), 'letters are sliders');
  c = compile('ax^2+bx+c');
  ok(eq(c.varNames, ['a', 'b', 'c']) && near(c.f(2, [2], { a: 1, b: 2, c: 3 }), 11), 'kx-style letters split off');
  ok(near(compile('xsin(x)').f(2, [], {}), 2 * Math.sin(2)) && near(compile('xx').f(3, [], {}), 9) && near(compile('x2').f(3, [2], {}), 6), 'names split longest-first');
  ok(near(compile('e^x').f(1, [], {}), Math.E) && compile('e^x').varNames.length === 0 && !compile('1').usesX, 'e is Euler, not a slider');
  for (const bad of ['x$', 'cos x', '(x', 'x+', 'window.x', 'a_1', 'sin(x,5)', 'log(x,2)'])
    { let threw = false; try { compile(bad); } catch { threw = true; } ok(threw, 'rejects ' + bad); }
  ok(shifted('sin(3x)*cos(5x)', 'c') === 'sin(3(x-c))*cos(5(x-c))' && shifted('kx+exp(-x^2)', 'c') === 'k(x-c)+exp(-(x-c)^2)', 'shift rewrite');
  ok(eq(T, [[1, 0, 0, 1], [1, 0, 0, -1], [0, 1, 1, 0], [0, 1, -1, 0], [-1, 0, 0, 1], [-1, 0, 0, -1], [0, -1, 1, 0], [0, -1, -1, 0]]), 'D4 in plan row order');
  ok(dihedral(6).length === 12 && dihedral(6).every(([a, b, c2, d]) => near(Math.abs(a * d - b * c2), 1)), 'D6: 12 isometries');
  ok(eq(closure([]), [0]) && eq(closure([6]), [0, 3, 5, 6]) && eq(closure([1, 4]), [0, 1, 4, 5]) && closure([1, 6]).length === 8, 'subgroups: trivial, C4, Klein, D4');
  ok(closure([1, 2, 3]).length === 8, 'rows 1–4 are not a subgroup');
  const par = (src, v = { c: 0.7 }, tol) => { const k = compile(src); return parityOf(sample(k.f, k.consts, v, 2, 400).ys, 2, tol); };
  ok(par('x^2') === 'even' && par('x^3-x') === 'odd' && par('tan(2x)/8') === 'odd' && par('sin(1/x)/2') === 'odd', 'parity detection');
  ok(par('sqrt(-1-x^2)') === null && par('1') === 'even', 'no finite samples: no verdict; a constant is even');
  ok(STARTERS.slice(0, 5).every(s => par(s) === null) && STARTERS.slice(5).every(s => par(s) !== null), 'starters: 5 free, 4 with parity');
  ok(par('sin(3(x-c))') === null, 'shift breaks parity');
  ok(par('sin(9(x-c))', { c: 0.7 }, 0.1) !== null && par('sin(9(x-c))', { c: 1.1 }, 0.1) === null, 'near-parity (9·0.7 ≈ 2π) fails the strict check');
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 25; i++) {
    const p = randomPiece(rnd), k = compile(p.src);
    ok(parityOf(sample(k.f, k.consts, p.vars, 2, 400).ys, 2, 0.1) === null, 'random piece has no near-parity: ' + p.src);
  }
  return 'selftest ok';
}

if (typeof document === 'undefined') { if (typeof process !== 'undefined' && process.argv.includes('--test')) console.log(selfTest()); }
else ui();

function ui() {
  // ---------- state: defaults ← localStorage ← URL hash, all in the one hash format ----------
  const DEFAULTS = { src: STARTERS[0], gens: [1, 6], palette: 'Spectrum', lw: 1.5, R: 2, vars: {}, cap: true };
  function decode(h) {                                    // the hash is untrusted input: whitelist and clamp everything
    const q = new URLSearchParams(h.replace(/\+/g, '%2B')), o = {};   // keep a hand-written '+' as plus, not space
    const num = (k, lo, hi) => { const v = +q.get(k); return q.has(k) && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined; };
    if (q.has('f')) o.src = q.get('f').slice(0, 200);
    if (q.has('g')) o.gens = [...new Set(q.get('g').match(/[1-7]/g) || [])].map(Number);
    if (Object.hasOwn(PALETTES, q.get('p'))) o.palette = q.get('p');
    const lw = num('lw', 0.5, 6), R = num('R', 0.5, 10);
    if (lw != null) o.lw = lw; if (R != null) o.R = R;
    if (q.has('cap')) o.cap = q.get('cap') === '1';
    o.vars = {};
    for (const [k, v] of q) if (/^v\.[a-zA-Z]$/.test(k) && Number.isFinite(+v)) o.vars[k.slice(2)] = Math.min(5, Math.max(-5, +v));
    return o;
  }
  const encode = (src = S.src) => '#' + [`f=${encodeURIComponent(src)}`, `g=${S.gens.join('')}`, `p=${S.palette}`, `lw=${S.lw}`, `R=${S.R}`,
    `cap=${S.cap ? 1 : 0}`, ...Object.entries(S.vars).map(([k, v]) => `v.${k}=${fmt(v)}`)].join('&');
  let stored = ''; try { stored = localStorage.mathart || ''; } catch {}
  const S = { ...DEFAULTS, ...decode(stored.slice(1)), ...(location.hash.length > 1 ? decode(location.hash.slice(1)) : {}) };
  S.on = closure(S.gens);
  let hashTimer;
  function save() {
    try { localStorage.mathart = encode(); } catch {}
    clearTimeout(hashTimer);                              // Safari caps replaceState at 100 per 30 s, so debounce
    hashTimer = setTimeout(() => { try { history.replaceState(null, '', location.pathname + encode()); } catch {} }, 300);   // drops ?s=1 so reloads aren't counted as arrivals
  }
  addEventListener('hashchange', () => location.reload());   // a pasted link into an open tab; replaceState never fires this
  const NATIVE = !!window.Capacitor?.isNativePlatform?.();  // inside the iOS/Android app, as opposed to a browser
  // Stamped link: ?s=1 is countable, the hash is not. In the app location.href is the webview's own origin, so use the public site there.
  const link = () => (NATIVE ? SITE : location.href.split(/[?#]/)[0]) + '?s=1' + encode(S.okSrc ?? S.src);

  const $ = id => document.getElementById(id);
  const dark = () => document.documentElement.dataset.theme === 'dark';
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const colors = () => PALETTES[S.palette].map(([h, s]) =>
    `hsl(${h} ${s}% ${s ? (dark() ? 65 : 42) : (dark() ? 92 : 12)}%)`);
  const dupsOf = parity => parity ? PAIRS[parity].filter(([i, j]) => S.on.includes(i) && S.on.includes(j)).map(([, j]) => j) : [];
  const freeLetter = () => [...'cdpqrstuvw'].find(n => !(S.varNames || []).includes(n));

  // ---------- drawing ----------
  function draw(ctx, W, H, lw, caption) {                 // returns the parity of f: 'even' | 'odd' | null
    const { f, consts, vars, R } = S, N = 2000, m = Math.min(W, H), s = m / (2 * R), cx = W / 2, cy = H / 2;
    ctx.fillStyle = css('--bg'); ctx.fillRect(0, 0, W, H);
    if (!f) return null;
    const { xs, ys } = sample(f, consts, vars, R, N), parity = parityOf(ys, R), hide = new Set(dupsOf(parity));
    ctx.save(); ctx.beginPath(); ctx.rect(cx - m / 2, cy - m / 2, m, m); ctx.clip();   // the view is the centred square, so the screen matches the export
    ctx.lineWidth = lw; ctx.lineJoin = ctx.lineCap = 'round';
    const cols = colors();
    T.forEach(([a, b, c, d], k) => {
      if (!S.on.includes(k) || hide.has(k)) return;       // a coincident copy adds nothing but blended color
      ctx.strokeStyle = cols[k]; ctx.beginPath();
      let pen = false;
      for (let i = 0, prev = NaN; i <= N; i++) {
        const x = xs[i], y = ys[i];
        if (y !== y) pen = false;
        else if (pen && Math.abs(y - prev) > 2 * R) {     // a jump taller than the view: lift only if f blows up in between (a pole), not for a steep curve
          const ym = f((xs[i - 1] + x) / 2, consts, vars);   // ponytail: one midpoint; shallow poles at large zoom-out still streak
          if (!(Math.abs(ym) < Math.max(Math.abs(y), Math.abs(prev)))) pen = false;
        }
        prev = y;
        if (y !== y) continue;
        ctx[pen ? 'lineTo' : 'moveTo'](cx + (a * x + b * y) * s, cy - (c * x + d * y) * s);
        pen = true;
      }
      ctx.stroke();
    });
    ctx.restore();
    if (caption) {
      const text = `f(x) = ${S.okSrc} · ${APP}`;
      let size = Math.round(W / 56);
      ctx.fillStyle = css('--muted'); ctx.textBaseline = 'bottom';
      do { ctx.font = `${size}px system-ui, -apple-system, sans-serif`; } while (ctx.measureText(text).width > W * 0.95 && --size > 8);
      ctx.fillText(text, W / 40, H - W / 40);
    }
    return parity;
  }

  const canvas = $('c'), ctx = canvas.getContext('2d');
  let dpr = 1;
  const render = () => showParity(draw(ctx, canvas.width, canvas.height, S.lw * dpr, false));
  new ResizeObserver(() => {
    dpr = devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr);
    render();
  }).observe(canvas);

  // ---------- controls ----------
  function showParity(parity) {
    const dups = dupsOf(parity), name = freeLetter();
    [...$('sym').children].forEach((c, k) => c.classList.toggle('dim', dups.includes(k)));
    const show = dups.length && S.usesX && !$('err').textContent;   // nothing to fix without an x, and never over a stale picture
    $('parity').hidden = !show;
    if (show) {
      $('ptext').textContent = `f is ${parity}: ${dups.length} of the ${S.on.length} copies coincide.`;
      $('fix').hidden = !name; $('fix').textContent = `Fix: shift x by ${name}`;
    }
  }
  function setFormula(src) {
    S.src = src;
    try {
      const c = compile(src);
      Object.assign(S, { f: c.f, consts: c.consts, parts: c.parts, varNames: c.varNames, usesX: c.usesX, okSrc: src });
      S.vars = Object.fromEntries(c.varNames.map(n => [n, S.vars[n] ?? 1]));
      $('err').textContent = ''; buildSliders();
    } catch (e) { $('err').textContent = e.message; }
    if ($('formula').value !== src) $('formula').value = src;
    save(); render();
  }
  function buildSliders() {
    const slider = (label, aria, min, max, step, value, set) => {
      const l = document.createElement('label'); l.className = 'row';
      l.innerHTML = `<output>${label(value)}</output><input type="range" aria-label="${aria}" min="${min}" max="${max}" step="${step}" value="${value}">`;
      l.querySelector('input').oninput = e => { set(+e.target.value); l.querySelector('output').value = label(+e.target.value); save(); render(); };
      return l;
    };
    $('consts').replaceChildren(
      ...S.consts.map((v, i) => {                         // ponytail: range ±2|v|; add editable bounds if asked
        const span = Math.max(Math.abs(v), 0.5) * 2;
        return slider(fmt, `constant ${i + 1}`, -span, span, span / 200, v, w => { S.consts[i] = w; $('formula').value = S.src = S.okSrc = join(S.parts, S.consts); });
      }),
      ...S.varNames.map(n => slider(w => `${n} = ${fmt(w)}`, n, -5, 5, 0.01, S.vars[n], w => { S.vars[n] = w; })));   // letters: named sliders, nothing to rewrite
  }
  function setGens(gens) { S.gens = gens; S.on = closure(gens); save(); paintSym(); render(); }
  function paintSym() {                                   // preset + chip states and colors follow state, palette, theme
    const cols = colors(), on = S.on.join();
    [...$('presets').children].forEach((b, i) => b.setAttribute('aria-pressed', PRESETS[i].on.join() === on));
    [...$('sym').children].forEach((c, k) => {
      c.style.setProperty('--c', cols[k]); c.setAttribute('aria-pressed', S.on.includes(k)); c.classList.toggle('gen', S.gens.includes(k));
    });
  }
  const chip = (text, onclick) => { const b = document.createElement('button'); b.className = 'chip'; b.textContent = text; b.onclick = onclick; return b; };

  $('formula').oninput = e => setFormula(e.target.value);
  $('starters').replaceChildren(...STARTERS.map(s => chip(s, () => setFormula(s))));
  $('presets').replaceChildren(...PRESETS.map(p => chip(p.name, () => setGens(p.gens))));
  $('sym').replaceChildren(...LABELS.map((lab, k) => {
    // a tap adds the move as a generator (ringed); tapping a generator again removes it and the closure shrinks to what the rest make
    const b = chip(lab, () => S.gens.includes(k) ? setGens(S.gens.filter(g => g !== k)) : S.on.includes(k) ? null : setGens([...S.gens, k]));
    b.disabled = k === 0;                                 // "as drawn" is the identity, always on
    return b;
  }));
  $('fix').onclick = () => {                              // f(x) → f(x − c), with c started where the copies are clearly apart
    const name = freeLetter(), src = shifted(S.okSrc, name), c = compile(src);
    S.vars[name] = [0.7, 1.1, 0.4, 1.7, 2.3].find(v => !parityOf(sample(c.f, c.consts, { ...S.vars, [name]: v }, S.R, 400).ys, S.R, S.R / 20)) ?? 0.7;
    setFormula(src);
  };
  $('palette').replaceChildren(...Object.keys(PALETTES).map(k => new Option(k, k, false, k === S.palette)));
  $('palette').onchange = e => { S.palette = e.target.value; save(); paintSym(); render(); };
  $('lw').value = S.lw; $('lw').oninput = e => { S.lw = +e.target.value; save(); render(); };
  $('R').value = S.R; $('R').oninput = e => { S.R = +e.target.value; save(); render(); };   // the range is rtl in CSS, so right = zoom in
  $('cap').checked = S.cap; $('cap').onchange = e => { S.cap = e.target.checked; save(); };
  const setTheme = t => { document.documentElement.dataset.theme = t; paintSym(); render(); };
  $('theme').onclick = () => {
    const t = dark() ? 'light' : 'dark';
    try { localStorage['mathart.theme'] = t; } catch {}  // a manual choice sticks; otherwise the page follows the system
    setTheme(t);
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    let pinned = false; try { pinned = !!localStorage['mathart.theme']; } catch {}
    if (!pinned) setTheme(e.matches ? 'dark' : 'light');
  });
  $('rand').onclick = () => {
    const piece = randomPiece(), keys = Object.keys(PALETTES);
    S.palette = $('palette').value = keys[Math.random() * keys.length | 0];
    S.R = +(1.2 + Math.random() * 2.3).toFixed(1); $('R').value = S.R;
    if (Math.random() < 1 / 3) { const p = PRESETS[1 + (Math.random() * (PRESETS.length - 1) | 0)]; S.gens = p.gens; S.on = p.on; }
    S.vars = piece.vars; paintSym(); setFormula(piece.src);
  };
  // ---------- export: in the app, Save to Photos and the share sheet via the Capacitor bridge; in a browser, download and Web Share ----------
  // Raw bridge call. Capacitor.Plugins is only filled by the @capacitor/core JS runtime, which this bundler-free page never loads;
  // nativePromise is the primitive that runtime uses, present in native-bridge.js on both platforms.
  const call = NATIVE ? (plugin, method, opts) => window.Capacitor.nativePromise(plugin, method, opts) : null;
  const flash = (b, t, back) => { b.textContent = t; setTimeout(() => { b.textContent = back; }, 1500); };
  const exportCanvas = () => {                            // the square view at 2048 px; Studio adds 4096
    const c = document.createElement('canvas'); c.width = c.height = 2048;
    draw(c.getContext('2d'), 2048, 2048, S.lw * 2048 / Math.min(canvas.clientWidth, canvas.clientHeight), S.cap);
    return c;
  };
  $('share').onclick = async () => {
    const url = link(), text = `f(x) = ${S.okSrc ?? S.src}`;
    try {
      if (call) {                                         // picture attached; the text carries the formula and the stamped link
        const { uri } = await call('Filesystem', 'writeFile', { path: `${APP}.png`, data: exportCanvas().toDataURL('image/png').split(',')[1], directory: 'CACHE' });
        await call('Share', 'share', { text: `${text} ${url}`, files: [uri] });
      } else if (navigator.share) await navigator.share({ text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); flash($('share'), 'Copied link', 'Share'); }
    } catch {}                                            // includes the user dismissing the sheet
  };
  $('save').onclick = async () => {
    const c = exportCanvas();
    if (!call) return c.toBlob(b => {                     // browser: download
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(b), download: `${APP}.png` });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    try {                                                 // iOS: add-only photo permission, no album. Android: the app's own album, no permission prompt
      let albumIdentifier;
      if (window.Capacitor.getPlatform() === 'android') {
        const find = async () => (await call('Media', 'getAlbums')).albums.find(a => a.name === APP)?.identifier;
        albumIdentifier = (await find()) ?? (await call('Media', 'createAlbum', { name: APP }), await find());
      }
      await call('Media', 'savePhoto', { path: c.toDataURL('image/png'), albumIdentifier, fileName: `${APP}-${Date.now()}` });
      flash($('save'), 'Saved', 'Save PNG');
    } catch { flash($('save'), 'Not saved', 'Save PNG'); }
  };

  paintSym(); setFormula(S.src);
}

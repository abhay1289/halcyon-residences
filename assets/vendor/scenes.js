/* Scene stepper + clean outline text — shared across the prototypes.
 *
 * Hero: the FIRST range registered with add() (or the .hero / #top section when nothing
 * is registered) is the hero. It scrolls normally — no stepping — and gets a small glass
 * play button (lower right) that glides through the whole hero hands-free.
 *
 * SceneStepper: inside any LATER registered range, one wheel flick / swipe / key press
 * plays exactly one scene (an eased Lenis scroll to the next stop). Trackpad momentum
 * is ignored, so a single gesture never skips two scenes. Past the last stop the
 * gesture is released and normal scrolling continues.
 *
 *   SceneStepper.init(lenis)
 *   SceneStepper.add({ st, stops: [0, .22, .38, 1], duration: 1.5 })   // st = ScrollTrigger
 *   SceneStepper.stopsFromBeats(sectionEl)  // derives stops from .beat[data-in][data-out]
 *
 * TextOutline: an SVG filter that traces only the outer edge of the glyphs, so outline
 * type never shows the overlapping contours that -webkit-text-stroke draws on variable
 * fonts. Use `color: <stroke colour>; filter: url(#tx-outline)` (or `#tx-outline-2` for
 * a heavier line) instead of `-webkit-text-stroke`.
 */
(function () {
  // gentle sine in/out: soft start and landing, steady middle so the footage reads
  const ease = t => -(Math.cos(Math.PI * t) - 1) / 2;
  const steppers = [];
  let lenis = null, busy = false, lastWheel = 0, lastCaptured = false, touchY = null, release = 0, lastAbs = 0, fell = 0, trough = Infinity, queued = 0;

  function bounds(s) { return { a: s.st.start, b: s.st.end }; }
  function stopsPx(s) { const { a, b } = bounds(s); return s.stops.map(p => a + p * (b - a)); }

  // the stepper whose range contains the current scroll position
  function current() {
    const y = lenis ? lenis.scroll : scrollY;
    return steppers.find(s => { const { a, b } = bounds(s); return y >= a - 2 && y <= b + 2; });
  }

  // next stop in a direction, or null when the gesture should leave the scene
  function target(s, dir) {
    const y = lenis.scroll, px = stopsPx(s);
    if (dir > 0) return px.find(v => v > y + 4) ?? null;
    for (let i = px.length - 1; i >= 0; i--) if (px[i] < y - 4) return px[i];
    return null;
  }

  function go(y, s) {
    busy = true;
    const done = () => {
      if (!busy) return;
      busy = false; release = performance.now();
      // a swipe made during the glide plays right after it
      if (queued) { const d = queued; queued = 0; step(d, true); }
    };
    lenis.scrollTo(y, { duration: s.duration, easing: ease, lock: true, force: true, onComplete: done });
    setTimeout(() => busy && done(), s.duration * 1000 + 400);
  }

  // returns true when the gesture was consumed by a scene
  function step(dir, fresh) {
    const s = current();
    if (!s) return false;
    const y = target(s, dir);
    if (y === null) return false;
    if (!busy && fresh) go(y, s);
    return true;
  }

  function onWheel(e) {
    if (!steppers.length || e.ctrlKey) return;
    const now = performance.now(), gap = now - lastWheel;
    lastWheel = now;
    const dir = Math.sign(e.deltaY);
    if (!dir) return;
    // a new gesture = a pause in the wheel stream, the first event inside a scene, or a fresh
    // push that spikes above the fading trackpad momentum (momentum only ever decays)
    const abs = Math.abs(e.deltaY);
    if (gap > 180) { fell = 0; trough = Infinity; }
    // trackpad momentum only decays. A push that climbs well above the lowest point of a
    // decaying tail is a new swipe; a swipe's own ramp-up (no tail before it) is not.
    let surge = false;
    if (abs <= lastAbs) { fell++; trough = Math.min(trough, abs); }
    else if (fell >= 3 && abs > trough * 1.5 + 8) { surge = true; fell = 0; trough = Infinity; }
    lastAbs = abs;
    const fresh = gap > 180 || !lastCaptured || surge;
    let consumed;
    if (busy) { consumed = !!current(); if (consumed && fresh) queued = dir; }
    else consumed = step(dir, fresh);
    lastCaptured = consumed;
    if (consumed) { e.preventDefault(); e.stopImmediatePropagation(); }
  }

  function onKey(e) {
    const map = { ArrowDown: 1, PageDown: 1, ' ': 1, ArrowUp: -1, PageUp: -1 };
    const dir = map[e.key] * (e.key === ' ' && e.shiftKey ? -1 : 1);
    if (!dir || /input|textarea|select/i.test(e.target.tagName)) return;
    if (busy && current()) return e.preventDefault();
    if (step(dir, true)) e.preventDefault();
  }

  function onTouchStart(e) { touchY = e.touches[0].clientY; }
  function onTouchMove(e) {
    if (touchY === null) return;
    const dy = touchY - e.touches[0].clientY;
    if (Math.abs(dy) < 6) return;
    const s = current();
    if (s && (busy || target(s, Math.sign(dy)) !== null)) e.preventDefault();
  }
  function onTouchEnd(e) {
    if (touchY === null) return;
    const dy = touchY - (e.changedTouches[0] || {}).clientY;
    touchY = null;
    if (Math.abs(dy) > 30) step(Math.sign(dy), true);
  }

  // ---- hero autoplay ----
  let hero = null, btn = null, playing = false, raf = 0;
  // linear glide with short soft ends, so every scene plays at the same pace
  const glide = t => { const a = .06, k = 1 / (2 * a * (1 - a)); return t < a ? k * t * t : t > 1 - a ? 1 - k * (1 - t) * (1 - t) : (t - a / 2) / (1 - a); };
  const sy = () => (lenis ? lenis.scroll : scrollY);
  function heroRange() {
    if (hero && hero.st) return { a: hero.st.start, b: hero.st.end, n: hero.stops ? hero.stops.length : 0 };
    const el = document.querySelector('.hero') || document.getElementById('top') || document.querySelector('section');
    if (!el) return null;
    const a = el.getBoundingClientRect().top + sy();
    return { a, b: a + Math.max(0, el.offsetHeight - innerHeight), n: 0 };
  }
  function setPlaying(on) {
    playing = on;
    if (btn) { btn.classList.toggle('is-playing', on); btn.setAttribute('aria-label', on ? 'Pause' : 'Play the intro'); }
  }
  function stop() {
    if (!playing) return;
    cancelAnimationFrame(raf);
    if (lenis) lenis.scrollTo(sy(), { immediate: true, force: true });
    setPlaying(false);
  }
  function play() {
    const r = heroRange();
    if (!r || r.b - r.a < 20) return;
    let from = sy();
    if (from < r.a - 2 || from >= r.b - 8) from = r.a;      // outside or at the end: start over
    const span = r.b - r.a;
    const full = r.n > 1 ? (r.n - 1) * 3 : Math.max(9, span / innerHeight * 1.6);
    const dur = Math.max(1.2, full * (r.b - from) / span);
    setPlaying(true);
    if (lenis) {
      lenis.scrollTo(from, { immediate: true, force: true });
      lenis.scrollTo(r.b, { duration: dur, easing: glide, force: true, onComplete: () => setPlaying(false) });
    } else {
      const t0 = performance.now();
      const tick = now => {
        const t = Math.min(1, (now - t0) / (dur * 1000));
        scrollTo(0, from + (r.b - from) * glide(t));
        t < 1 ? (raf = requestAnimationFrame(tick)) : setPlaying(false);
      };
      raf = requestAnimationFrame(tick);
    }
  }
  function mountButton() {
    if (btn || /[?&]shot=/.test(location.search)) return;
    const css = document.createElement('style');
    css.textContent = `.hero-play{position:fixed;right:max(18px,env(safe-area-inset-right));bottom:calc(var(--hero-play-b,18px) + env(safe-area-inset-bottom));z-index:90;width:38px;height:38px;border-radius:50%!important;padding:0;margin:0;display:grid;place-items:center;cursor:pointer;color:#fff;background:rgba(18,18,20,.16);border:1px solid rgba(255,255,255,.55);-webkit-backdrop-filter:blur(10px) saturate(1.3);backdrop-filter:blur(10px) saturate(1.3);box-shadow:0 2px 14px rgba(0,0,0,.18);filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));opacity:.85;transition:opacity .35s,transform .35s,visibility .35s;-webkit-tap-highlight-color:transparent}
.hero-play:hover,.hero-play:focus-visible{opacity:1;transform:scale(1.06)}
.hero-play.is-off{opacity:0;visibility:hidden;pointer-events:none}
.hero-play svg{width:12px;height:12px;overflow:visible}
.hero-play .hp-pause{display:none}.hero-play.is-playing .hp-play{display:none}.hero-play.is-playing .hp-pause{display:block}`;
    document.head.appendChild(css);
    btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'hero-play'; btn.setAttribute('aria-label', 'Play the intro');
    btn.innerHTML = '<svg class="hp-play" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M3.2 1.6v8.8L10.4 6z"/></svg><svg class="hp-pause" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M4 2v8M8 2v8"/></svg>';
    btn.addEventListener('click', () => (playing ? stop() : play()));
    document.body.appendChild(btn);
    // any manual scroll input takes over from the autoplay
    ['wheel', 'touchstart'].forEach(ev => addEventListener(ev, () => playing && stop(), { passive: true }));
    addEventListener('keydown', e => playing && /Arrow|Page|Home|End|^ $/.test(e.key) && stop());
    // only shown while the hero is on screen
    const vis = () => { const r = heroRange(); btn.classList.toggle('is-off', !!r && sy() > r.b + innerHeight * .4); };
    lenis ? lenis.on('scroll', vis) : addEventListener('scroll', vis, { passive: true });
    vis();
  }
  const mount = () => (document.body ? setTimeout(mountButton, 0) : addEventListener('DOMContentLoaded', mountButton));

  window.SceneStepper = {
    play, stop,
    init(l) {
      if (!l || lenis) return;
      lenis = l;
      mount();
      addEventListener('wheel', onWheel, { passive: false, capture: true });
      addEventListener('keydown', onKey, { capture: true });
      addEventListener('touchstart', onTouchStart, { passive: true });
      addEventListener('touchmove', onTouchMove, { passive: false });
      addEventListener('touchend', onTouchEnd, { passive: true });
    },
    // the first range is the hero: normal scroll + play button; later ranges still step
    add(opts) { if (!hero) { hero = opts; mount(); return; } steppers.push({ duration: 2.8, ...opts }); },
    stopsFromBeats(section) {
      const beats = [...section.querySelectorAll('.beat[data-in]')].map(b => [+b.dataset.in, +b.dataset.out]);
      return beats.map(([a, b], i) => (i === 0 ? 0 : i === beats.length - 1 ? 1 : (a + Math.min(b, 1)) / 2));
    }
  };

  // ---- clean outline type ----
  const svg = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
    <filter id="tx-outline" x="-4%" y="-8%" width="108%" height="116%" color-interpolation-filters="sRGB">
      <feMorphology in="SourceGraphic" operator="dilate" radius="1" result="d"/>
      <feComposite in="d" in2="SourceGraphic" operator="out"/>
    </filter>
    <filter id="tx-outline-2" x="-4%" y="-8%" width="108%" height="116%" color-interpolation-filters="sRGB">
      <feMorphology in="SourceGraphic" operator="dilate" radius="1.6" result="d"/>
      <feComposite in="d" in2="SourceGraphic" operator="out"/>
    </filter>
  </svg>`;
  const inject = () => document.body.insertAdjacentHTML('afterbegin', svg);
  document.body ? inject() : addEventListener('DOMContentLoaded', inject);
  // no Lenis (reduced motion) still gets the button
  addEventListener('DOMContentLoaded', () => setTimeout(() => !btn && mountButton(), 300));
})();
/* NOTE for outline type: the filter needs an OPAQUE colour. For a faint outline put the
   transparency on `opacity`, not in the colour (rgba fill breaks the trace). */

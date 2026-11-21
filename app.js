/* Halcyon Residences — scrollytelling homepage prototype */
gsap.registerPlugin(ScrollTrigger);

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = v => Math.min(1, Math.max(0, v));
const pad = n => String(n).padStart(2, '0');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const shot = new URLSearchParams(location.search).get('shot'); // debug: ?shot=0..1 jumps straight to a scroll position

document.body.classList.add('is-loading');

/* ---------- smooth scroll ---------- */
let lenis;
if (!reduce && window.Lenis) {
  lenis = new Lenis({ duration: 1.3, easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
  lenis.stop();
  lenis.on('scroll', ScrollTrigger.update);
  window.SceneStepper && SceneStepper.init(lenis);
  gsap.ticker.add(t => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  $$('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
    const id = a.getAttribute('href');
    if (id.length > 1 && $(id)) { e.preventDefault(); lenis.scrollTo($(id), { duration: 2.2 }); }
  }));
}

/* ---------- split headline lines ---------- */
$$('.mega').forEach(el => {
  el.innerHTML = el.innerHTML.split(/<br\s*\/?>/i).map(h => `<span class="line"><span>${h.trim()}</span></span>`).join('');
});

/* ---------- canvas image sequence ---------- */
class Sequence {
  constructor(canvas, dir, count) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.dir = dir; this.count = count; this.frames = []; this.current = -1;
    addEventListener('resize', () => this.resize());
    this.resize();
  }
  src(i) { return `${this.dir}/f_${String(i + 1).padStart(4, '0')}.webp`; }
  load(onProgress) {
    const order = [];
    for (const step of [8, 4, 2, 1]) for (let i = 0; i < this.count; i += step) if (!order.includes(i)) order.push(i);
    let done = 0;
    return Promise.all(order.map(i => new Promise(res => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = img.onerror = () => { this.frames[i] = img; done++; onProgress && onProgress(done / this.count); if (i === 0 || i === this.want) this.render(this.want ?? 0, true); res(); };
      img.src = this.src(i);
    })));
  }
  nearest(i) {
    if (this.frames[i]?.naturalWidth) return this.frames[i];
    for (let d = 1; d < this.count; d++) {
      if (this.frames[i - d]?.naturalWidth) return this.frames[i - d];
      if (this.frames[i + d]?.naturalWidth) return this.frames[i + d];
    }
    return null;
  }
  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = innerWidth * dpr; this.canvas.height = innerHeight * dpr;
    this.render(Math.max(0, this.current), true);
  }
  render(i, force) {
    this.want = i;
    if (i === this.current && !force) return;
    const img = this.nearest(i); if (!img) return;
    this.current = i;
    const { width: cw, height: ch } = this.canvas;
    const s = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    this.ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
  }
}

/* ---------- the lift (persistent floor indicator) ---------- */
const lift = {
  num: $('#liftNum'), label: $('#liftLabel'), arrow: $('#liftArrow'), car: $('#liftCar'),
  shown: 1, target: 1, tween: null,
  set(floor, label) {
    floor = Math.round(floor);
    if (label && this.label.textContent !== label) this.label.textContent = label;
    if (floor === this.target) return;
    this.arrow.classList.toggle('is-down', floor < this.target);
    this.target = floor;
    this.tween && this.tween.kill();
    const o = { v: this.shown };
    this.tween = gsap.to(o, { v: floor, duration: Math.min(1.6, .25 + Math.abs(floor - this.shown) * .03), ease: 'power2.inOut',
      onUpdate: () => { this.shown = Math.round(o.v); this.num.textContent = pad(this.shown); } });
  },
  jump(floor) { this.tween && this.tween.kill(); this.shown = this.target = Math.round(floor); this.num.textContent = pad(this.shown); }
};

/* ---------- hero beats ---------- */
function beatIn(b) {
  // only one beat on screen at a time: hard-hide every sibling beat first
  $$('.beat', b.parentElement).forEach(o => {
    if (o === b) return;
    gsap.killTweensOf([o, ...$$('.line>span, .kicker, .sub, .beat__ctas, .pill', o)]);
    gsap.set(o, { autoAlpha: 0 });
  });
  gsap.killTweensOf(b);
  gsap.set(b, { autoAlpha: 1 });
  const st = b.closest('.hero__sticky');
  if (st) st.dataset.side = b.classList.contains('beat--right') ? 'right' : b.classList.contains('beat--final') ? 'center' : 'left';
  gsap.fromTo($$('.line>span', b), { yPercent: 110 }, { yPercent: 0, duration: 1.2, ease: 'expo.out', stagger: .08, overwrite: true });
  gsap.fromTo($$('.kicker, .sub, .beat__ctas, .pill', b), { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1, ease: 'expo.out', delay: .15, stagger: .07, overwrite: true });
}
function beatOut(b) {
  gsap.to($$('.line>span', b), { yPercent: -60, duration: .25, ease: 'power2.in', overwrite: true });
  gsap.to(b, { autoAlpha: 0, duration: .25, ease: 'power2.in', overwrite: true });
}

function setupHero(seq) {
  const hero = $('#hero');
  const beats = $$('.beat', hero).map(el => ({ el, a: +el.dataset.in, b: +el.dataset.out, on: false }));
  beats[0].on = true;
  const tag = $('#heroTag'), ft = $('#heroFt'), ghost = $('.hero__ghost');
  const st = ScrollTrigger.create({
    trigger: hero, start: 'top top', end: 'bottom bottom', scrub: true,
    onUpdate(self) {
      const p = self.progress;
      const vp = clamp01((p - .06) / .92);
      seq && seq.render(Math.round(vp * (seq.count - 1)));
      // footage map: arrival .00–.174 · lobby + lift .174–.482 · rise .482–.588 · penthouse –.85 · terrace
      const RISE_A = .482, RISE_B = .588, PH = .85;
      const floor = 1 + 61 * clamp01((vp - RISE_A) / (RISE_B - RISE_A));
      const f = Math.round(floor);
      ft.textContent = Math.round((f - 1) * 13.4).toLocaleString();
      gsap.set('.hero__status', { autoAlpha: p > .97 ? 0 : 1 });
      ghost.textContent = pad(f);
      gsap.set(ghost, { opacity: p > .5 && p < .61 ? .45 : 0, y: (1 - clamp01((p - .5) / .11)) * 60 });
      const state = vp < .174 ? 'Arrival' : vp < RISE_A ? 'Lobby' : vp < RISE_B ? 'Rising' : vp < PH ? 'The Penthouse' : 'Sky terrace';
      if (tag.textContent !== state) { tag.textContent = state; tag.classList.toggle('is-top', vp >= RISE_B); }
      if (self.isActive || p >= 1) lift.set(floor, vp < .174 ? 'Arrival' : vp < RISE_A ? 'Lobby' : vp < RISE_B ? 'Going up' : 'Penthouse');
      beats.forEach(bt => {
        const inside = p >= bt.a && p < bt.b;
        if (inside && !bt.on) { bt.on = true; beatIn(bt.el); }
        else if (!inside && bt.on) { bt.on = false; beatOut(bt.el); }
      });
    }
  });
  // one wheel flick / swipe = one scene, 3s, sine ease
  window.SceneStepper && SceneStepper.add({ st, stops: SceneStepper.stopsFromBeats(hero), duration: 3 });
}

/* ---------- everything after the hero ---------- */
function setupSections() {
  // each section is a floor: the lift travels to it
  $$('.floor').forEach(sec => {
    ScrollTrigger.create({
      trigger: sec, start: 'top 55%', end: 'bottom 55%',
      onToggle: s => s.isActive && lift.set(+sec.dataset.floor, sec.dataset.label)
    });
  });
  ScrollTrigger.create({ trigger: '#hero', start: 'top top', end: 'bottom 55%', onEnterBack: () => lift.set(62, 'Penthouse') });

  // lift car = whole page progress
  ScrollTrigger.create({ start: 0, end: 'max', onUpdate: s => gsap.set(lift.car, { y: -s.progress * ($('.lift__shaft').offsetHeight - 14) }) });

  // elevator door wipes (signature transition)
  $$('.doors').forEach(d => {
    const [l, r] = $$('i', d);
    const tl = gsap.timeline({ scrollTrigger: { trigger: d.parentElement, start: 'top 92%', end: 'top 25%', scrub: true } })
      .to(l, { xPercent: -101, ease: 'power2.inOut' }, 0)
      .to(r, { xPercent: 101, ease: 'power2.inOut' }, 0);
    window.SceneStepper && SceneStepper.add({ st: tl.scrollTrigger, stops: [0, 1], duration: 2.6 });
  });

  // section headlines
  $$('section:not(.hero) .mega').forEach(m => gsap.from($$('.line>span', m), {
    yPercent: 110, duration: 1.4, ease: 'expo.out', stagger: .1, scrollTrigger: { trigger: m, start: 'top 82%' }
  }));
  $$('section:not(.hero) .kicker, section:not(.hero) .body').forEach(k => gsap.from(k, {
    y: 24, autoAlpha: 0, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: k, start: 'top 88%' }
  }));

  // statement
  gsap.fromTo('.statement__img img', { scale: 1.35, yPercent: -6 }, { scale: 1.05, yPercent: 6, ease: 'none', scrollTrigger: { trigger: '.statement__img', start: 'top bottom', end: 'bottom top', scrub: true } });
  gsap.from('.statement__img', { clipPath: 'inset(100% 0 0 0)', duration: 1.6, ease: 'expo.out', scrollTrigger: { trigger: '.statement__img', start: 'top 85%' } });
  gsap.fromTo('.statement__num', { yPercent: 20 }, { yPercent: -25, ease: 'none', scrollTrigger: { trigger: '.statement', start: 'top bottom', end: 'bottom top', scrub: true } });
  $$('[data-count]').forEach(el => {
    const o = { v: 0 }, suf = el.dataset.suffix || '';
    gsap.to(o, { v: +el.dataset.count, duration: 2.2, ease: 'power3.out', onUpdate: () => el.textContent = Math.round(o.v) + suf, scrollTrigger: { trigger: el, start: 'top 90%' } });
  });

  // residences: floor plates slide in from alternating sides
  $$('.slab').forEach((s, i) => {
    gsap.from(s, { x: i % 2 ? 140 : -140, autoAlpha: 0, duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: s, start: 'top 90%' } });
    gsap.from($('.slab__num', s), { yPercent: 60, duration: 1.6, ease: 'expo.out', scrollTrigger: { trigger: s, start: 'top 90%' } });
  });
  // peek the image of the slab nearest the centre on touch devices and while scrolling
  $$('.slab').forEach(s => ScrollTrigger.create({ trigger: s, start: 'top 58%', end: 'bottom 42%', toggleClass: 'is-peek' }));

  // amenities: the one pinned moment
  const svg = $('.amen__tower svg'), g = $('.floors', svg);
  for (let y = 580; y > 64; y -= 9) {
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ln.setAttribute('x1', 30); ln.setAttribute('x2', 90); ln.setAttribute('y1', y); ln.setAttribute('y2', y);
    g.appendChild(ln);
  }
  const ys = [590, 562, 480, 46], items = $$('.amen__list li'), ams = $$('.am'), amNo = $('#amNo'), hot = $('.hot');
  let cur = 0;
  const showAm = i => {
    if (i === cur) return;
    const dir = i > cur ? 1 : -1;
    items.forEach((li, k) => li.classList.toggle('is-on', k === i));
    gsap.to(hot, { attr: { cy: ys[i] }, duration: 1.1, ease: 'power3.inOut' });
    gsap.set(ams[i], { zIndex: 2 }); gsap.set(ams[cur], { zIndex: 1 });
    gsap.fromTo(ams[i], { clipPath: dir > 0 ? 'inset(100% 0% 0% 0%)' : 'inset(0% 0% 100% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.1, ease: 'expo.inOut' });
    gsap.fromTo($('img', ams[i]), { scale: 1.35 }, { scale: 1.12, duration: 1.6, ease: 'expo.out' });
    amNo.textContent = pad(i + 1);
    lift.set([1, 3, 12, 63][i], $('small', items[i]) ? items[i].childNodes[1].textContent.trim() : 'Amenities');
    cur = i;
  };
  const amST = ScrollTrigger.create({
    trigger: '.amenities', pin: '.amen__pin', start: 'top top', end: '+=240%',
    onUpdate: s => s.isActive && showAm(Math.min(3, Math.floor(s.progress * 4)))
  });
  // one stop per amenity, then release
  window.SceneStepper && SceneStepper.add({ st: amST, stops: [0, .375, .625, .875, 1], duration: 2.6 });
  gsap.from('.tw', { strokeDasharray: 1400, strokeDashoffset: 1400, duration: 2.4, ease: 'power2.inOut', scrollTrigger: { trigger: '.amenities', start: 'top 60%' } });

  // interiors: depth layers
  $$('.cl').forEach(c => {
    gsap.to(c, { y: () => +c.dataset.speed * -innerHeight, ease: 'none', scrollTrigger: { trigger: '.collage', start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.from(c, { clipPath: 'inset(0 0 100% 0)', duration: 1.6, ease: 'expo.out', scrollTrigger: { trigger: c, start: 'top 88%' } });
    gsap.fromTo($('img', c), { scale: 1.35 }, { scale: 1.05, ease: 'none', scrollTrigger: { trigger: c, start: 'top bottom', end: 'bottom top', scrub: true } });
  });
  gsap.fromTo('.interiors__word', { x: () => innerWidth * .03 }, { x: () => -innerWidth * .03, ease: 'none', scrollTrigger: { trigger: '.interiors', start: 'top bottom', end: 'bottom top', scrub: true } });
  gsap.from('.collage__note > *', { y: 30, autoAlpha: 0, stagger: .1, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: '.collage__note', start: 'top 85%' } });

  // floor plan draws itself
  const paths = $$('.pl path, .pl rect');
  paths.forEach(p => { const L = p.getTotalLength(); p.style.strokeDasharray = p.closest('.pl--dash') ? '4 6' : L; if (!p.closest('.pl--dash')) p.style.strokeDashoffset = L; });
  gsap.timeline({ scrollTrigger: { trigger: '.plan__svg', start: 'top 80%', end: 'center 45%', scrub: true } })
    .to($$('.pl:not(.pl--dash) path, .pl rect'), { strokeDashoffset: 0, ease: 'none', stagger: .05 })
    .from('.pl--dash', { autoAlpha: 0 }, '>-0.2')
    .from('.pl__lbl text', { autoAlpha: 0, y: 6, stagger: .03 }, '>-0.1');
  gsap.to('.pl__dot', { attr: { r: 9 }, opacity: .4, repeat: -1, yoyo: true, duration: 1.2, ease: 'sine.inOut' });

  // viewing: the doors open onto the terrace
  const vt = gsap.timeline({ scrollTrigger: { trigger: '.viewing', start: 'top 75%', end: 'top 5%', scrub: true } })
    .to('.vdoor--l', { xPercent: -101, ease: 'power2.inOut' }, 0)
    .to('.vdoor--r', { xPercent: 101, ease: 'power2.inOut' }, 0)
    .fromTo('.viewing__media img', { scale: 1.3 }, { scale: 1.05, ease: 'none' }, 0);
  window.SceneStepper && SceneStepper.add({ st: vt.scrollTrigger, stops: [0, 1], duration: 2.6 });
  gsap.from('.vform > *, .viewing__tel', { y: 30, autoAlpha: 0, stagger: .08, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: '.viewing', start: 'top 20%' } });

  // footer wordmark rises
  gsap.from('.foot__word', { yPercent: 50, ease: 'none', scrollTrigger: { trigger: '.foot', start: 'top bottom', end: 'bottom bottom', scrub: true } });

  // nav hide / show
  const nav = $('#nav'); let lastY = 0;
  ScrollTrigger.create({ start: 0, end: 'max', onUpdate: s => {
    const y = s.scroll(); nav.classList.toggle('is-scrolled', y > 60); nav.classList.toggle('is-hidden', y > lastY && y > 500); lastY = y;
  } });
}

/* ---------- boot ---------- */
async function boot() {
  let count = 0;
  try { count = (await (await fetch('assets/seq/manifest.json', { cache: 'no-store' })).json()).hero || 0; } catch (e) {}
  const seq = count ? new Sequence($('.hero__canvas'), 'assets/seq/hero', count) : null;

  // no splash: the poster frame is already on screen, frames stream in behind it
  seq && seq.load();
  setupHero(seq);
  setupSections();
  document.body.classList.remove('is-loading');

  if (shot !== null) {
    lenis && lenis.start();
    ScrollTrigger.refresh();
    const hp = new URLSearchParams(location.search).get('hp'); // debug: progress within the hero
    const H = $('#hero');
    const y = hp !== null ? H.offsetTop + +hp * (H.offsetHeight - innerHeight) : +shot * (document.documentElement.scrollHeight - innerHeight);
    if (lenis) { lenis.destroy(); lenis = null; }
    document.documentElement.style.scrollBehavior = 'auto';
    scrollTo(0, y);
    ScrollTrigger.update();
    if (+shot === 0 && hp === null) beatIn($('.beat--hero'));
    return;
  }

  lenis && lenis.start();
  ScrollTrigger.refresh();
  gsap.fromTo('.hero__frame', { scale: 1.14 }, { scale: 1.06, duration: 2.4, ease: 'expo.out' });
  gsap.from('.nav > *', { y: -24, autoAlpha: 0, duration: 1.1, ease: 'expo.out', stagger: .08, delay: .15 });
  gsap.from('.lift, .hero__status', { autoAlpha: 0, y: 20, duration: 1.1, ease: 'expo.out', delay: .4 });
  beatIn($('.beat--hero'));
}
boot();

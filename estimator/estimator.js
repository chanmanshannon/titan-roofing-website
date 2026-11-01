/*
 * Titan Roofing — instant roof estimate + quote comparison.
 * Pricing lives in pricing-config.js. This file is behavior only.
 */
(function () {
  'use strict';

  var P = window.TITAN_PRICING;
  if (!P) return;

  var $ = function (id) { return document.getElementById(id); };
  var qsa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var STEP_INDEX = { address: 0, measuring: 0, confirm: 1, manual: 1, material: 2, quote: 3, results: 4 };
  var API = '/api/roof-measure';

  var state = {
    step: 'address',
    history: [],
    satelliteAvailable: true,
    mode: null,               // 'satellite' | 'manual'
    address: '',
    measure: null,
    homeSqft: 2200,
    stories: '1',
    garage: 'yes',
    complexity: 'standard',
    pitch: 'standard',
    material: 'landmark',
    hasQuote: null,
    quote: null,
    items: {},
    insurance: false,
    leadSent: false
  };
  Object.keys(P.competitorGaps).forEach(function (k) { state.items[k] = 'unsure'; });

  /* ───────────────────────── helpers ───────────────────────── */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function r100(n) { return Math.round(n / 100) * 100; }
  function r50(n) { return Math.round(n / 50) * 50; }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function moneyK(n) {
    var k = n / 1000;
    return '$' + (k >= 100 ? Math.round(k) : (Math.round(k * 10) / 10)).toString() + 'k';
  }
  function num(n) { return Math.round(n).toLocaleString('en-US'); }
  function pct(f) { var p = Math.round((f - 1) * 100); return (p > 0 ? '+' : p < 0 ? '−' : '±') + Math.abs(p) + '%'; }
  function digits(s) { return Number(String(s).replace(/[^0-9.]/g, '')) || 0; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function track(name, data) {
    try {
      var payload = Object.assign({ event: name }, data || {});
      if (window.dataLayer && window.dataLayer.push) window.dataLayer.push(payload);
      if (typeof window.gtag === 'function') window.gtag('event', name, data || {});
    } catch (e) { /* analytics is optional */ }
  }

  // Deterministic pseudo-random so swatches look the same on every render.
  function seeded(seed) {
    var s = 0;
    for (var i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  /* ───────────────────────── icons ───────────────────────── */

  function storyIcon(n) {
    var h = n === 1 ? 15 : 27, y = 40 - h, apex = y - 12;
    var wins = '';
    for (var r = 0; r < n; r++) {
      var wy = 40 - (r + 1) * 13 + 4;
      wins += '<rect x="26" y="' + wy + '" width="7" height="6"/><rect x="39" y="' + wy + '" width="7" height="6"/>';
    }
    return '<svg viewBox="0 0 72 44" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M16 ' + y + ' L36 ' + apex + ' L56 ' + y + '"/><rect x="20" y="' + y + '" width="32" height="' + h + '"/>' +
      '<g stroke-width="1.5">' + wins + '</g><path d="M8 40 H64" stroke="#D1D5DB"/></svg>';
  }
  function shapeIcon(k) {
    var a = '<svg viewBox="0 0 72 44" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">';
    var red = ' stroke="#C41E3A" stroke-width="1.8"';
    if (k === 'simple') return a + '<rect x="10" y="7" width="52" height="30"/><path d="M10 22 H62"' + red + '/></svg>';
    if (k === 'standard') return a + '<rect x="10" y="7" width="52" height="30"/><path d="M24 22 H48 M10 7 L24 22 L10 37 M62 7 L48 22 L62 37"' + red + '/></svg>';
    return a + '<path d="M6 5 H44 V18 H66 V40 H28 V27 H6 Z"/><path d="M14 16 H34 M6 5 L14 16 L6 27 M44 5 L34 16 L28 22 M38 29 H56 M66 18 L56 29 L66 40 M28 27 L38 29 M44 18 L38 29"' + red + '/></svg>';
  }
  function pitchIcon(rise) {
    var h = Math.min(30, rise / 12 * 28), y = 38 - h;
    return '<svg viewBox="0 0 72 44" fill="none" aria-hidden="true">' +
      '<path d="M8 38 L36 ' + y.toFixed(1) + ' L64 38 Z" fill="#E8EDF5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M36 38 V' + y.toFixed(1) + '" stroke="#C41E3A" stroke-width="1.5" stroke-dasharray="2 3"/></svg>';
  }
  function swatchSVG(key, m) {
    var c = m.swatch, W = 240, H = 64, rnd = seeded(key), out = '';
    if (key === 'metal') {
      out += '<defs><linearGradient id="mg-' + key + '" x1="0" x2="1"><stop offset="0" stop-color="' + c.dark + '"/><stop offset="0.5" stop-color="' + c.light + '"/><stop offset="1" stop-color="' + c.base + '"/></linearGradient></defs>';
      out += '<rect width="' + W + '" height="' + H + '" fill="' + c.base + '"/>';
      for (var x = 0; x < W; x += 26) {
        out += '<rect x="' + x + '" width="26" height="' + H + '" fill="url(#mg-' + key + ')" opacity="0.55"/>';
        out += '<rect x="' + (x + 24) + '" width="3" height="' + H + '" fill="' + c.light + '"/>';
        out += '<rect x="' + (x + 27) + '" width="1.5" height="' + H + '" fill="' + c.dark + '"/>';
      }
    } else {
      var cols = [c.base, c.light, c.dark, c.base];
      out += '<rect width="' + W + '" height="' + H + '" fill="' + c.dark + '"/>';
      for (var row = 0, yy = -6; yy < H; row++, yy += 13) {
        var xx = -Math.floor(rnd() * 22);
        while (xx < W) {
          var w = 16 + Math.floor(rnd() * 22);
          var col = cols[Math.floor(rnd() * cols.length)];
          out += '<rect x="' + xx + '" y="' + yy + '" width="' + (w - 1.5) + '" height="12" fill="' + col + '"/>';
          if (rnd() > 0.55) out += '<rect x="' + xx + '" y="' + (yy + 7) + '" width="' + (w - 1.5) + '" height="5" fill="' + c.dark + '" opacity="0.45"/>';
          xx += w;
        }
        out += '<rect x="0" y="' + (yy + 12) + '" width="' + W + '" height="1.2" fill="#000" opacity="0.35"/>';
      }
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + out + '</svg>';
  }

  /* ───────────────────────── option groups ───────────────────────── */

  var GROUPS = {
    stories: [
      { v: '1', name: '1 story', icon: storyIcon(1) },
      { v: '2', name: '2 stories', icon: storyIcon(2) }
    ],
    garage: [
      { v: 'yes', name: 'Yes', meta: 'Adds about ' + P.garageFootprint + ' sq ft' },
      { v: 'no', name: 'No', meta: 'Detached or none' }
    ],
    complexity: Object.keys(P.complexity).map(function (k) {
      return { v: k, name: P.complexity[k].label, meta: P.complexity[k].desc, icon: shapeIcon(k) };
    }),
    pitch: Object.keys(P.pitch).map(function (k) {
      var p = P.pitch[k];
      return { v: k, name: p.label, meta: p.range + ' · ' + p.note, icon: pitchIcon(p.rise) };
    }),
    hasQuote: [
      { v: 'yes', name: 'Yes, compare it', meta: 'Takes about 20 seconds' },
      { v: 'no', name: 'Not yet', meta: 'Just show my estimate' }
    ]
  };

  var groupCounter = 0;
  function renderGroups() {
    qsa('[data-group]').forEach(function (box) {
      var g = box.getAttribute('data-group');
      if (g === 'material') return renderMaterials(box);
      if (!box.dataset.built) {
        var name = 'g-' + g + '-' + (groupCounter++);
        box.setAttribute('role', 'radiogroup');
        box.innerHTML = GROUPS[g].map(function (o) {
          return '<label class="opt"><input type="radio" name="' + name + '" value="' + o.v + '">' +
            '<span class="opt-face">' + (o.icon || '') + '<span class="opt-name">' + esc(o.name) + '</span>' +
            (o.meta ? '<span class="opt-meta">' + esc(o.meta) + '</span>' : '') + '</span></label>';
        }).join('');
        box.addEventListener('change', function (e) {
          if (!e.target.matches('input[type=radio]')) return;
          state[g] = e.target.value;
          syncGroups();
          onStateChange(g);
        });
        box.dataset.built = '1';
      }
    });
    syncGroups();
  }
  function syncGroups() {
    qsa('[data-group]').forEach(function (box) {
      var g = box.getAttribute('data-group');
      qsa('input[type=radio]', box).forEach(function (i) { i.checked = String(state[g]) === i.value; });
    });
  }

  function renderMaterials(box) {
    var keys = Object.keys(P.materials);
    if (!box.dataset.built) {
      box.setAttribute('role', 'radiogroup');
      box.innerHTML = keys.map(function (k) {
        var m = P.materials[k];
        return '<label class="opt mat"><input type="radio" name="g-material" value="' + k + '">' +
          '<span class="opt-face"><span class="mat-swatch">' + swatchSVG(k, m) + '</span>' +
          '<span class="mat-badge">' + esc(m.badge) + '</span>' +
          '<span class="mat-body"><span class="opt-name">' + esc(m.name) + '</span>' +
          '<span class="mat-price" data-price="' + k + '">–</span>' +
          '<span class="mat-blurb">' + esc(m.blurb) + '</span></span></span></label>';
      }).join('');
      box.addEventListener('change', function (e) {
        if (!e.target.matches('input[type=radio]')) return;
        state.material = e.target.value;
        onStateChange('material');
      });
      box.dataset.built = '1';
    }
    keys.forEach(function (k) {
      var e = estimate(k);
      var el = box.querySelector('[data-price="' + k + '"]');
      if (el) el.textContent = moneyK(e.low) + ' – ' + moneyK(e.high);
    });
    qsa('input', box).forEach(function (i) { i.checked = i.value === state.material; });
    var m = P.materials[state.material];
    $('matDetail').innerHTML = '<b>' + esc(m.name) + ':</b> ' + esc(m.warranty) +
      '<ul>' + m.specs.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
  }

  /* ───────────────────────── pricing ───────────────────────── */

  function pitchKeyFromRise(r) {
    if (r == null) return 'standard';
    if (r <= 4.5) return 'low';
    if (r <= 7.5) return 'standard';
    if (r <= 9.5) return 'steep';
    return 'vsteep';
  }
  function complexityFromPlanes(n) { return n <= 6 ? 'simple' : n <= 14 ? 'standard' : 'complex'; }

  function roofSqft() {
    if (state.mode === 'satellite' && state.measure) return state.measure.roofAreaSqft;
    var cx = P.complexity[state.complexity], pt = P.pitch[state.pitch];
    var footprint = state.homeSqft / (state.stories === '2' ? P.twoStoryDivisor : 1) +
      (state.garage === 'yes' ? P.garageFootprint : 0);
    return footprint * cx.overhang * pt.areaFactor;
  }
  function uncertainty() {
    if (state.mode === 'satellite' && state.measure) {
      return state.measure.quality === 'HIGH' ? P.uncertainty.satellite : P.uncertainty.satelliteLowQuality;
    }
    return P.uncertainty.manual;
  }
  function factors() {
    return {
      pitch: P.pitch[state.pitch].laborFactor,
      complexity: P.complexity[state.complexity].factor,
      stories: P.stories[state.stories] || 1
    };
  }
  function estimate(matKey) {
    var m = P.materials[matKey || state.material];
    var sq = roofSqft() / 100;
    var f = factors(), F = f.pitch * f.complexity * f.stories, u = uncertainty();
    // Price spread and measurement margin are independent, so combine them
    // as root-sum-square rather than stacking them (which overstates the range).
    var mid = sq * (m.perSquare[0] + m.perSquare[1]) / 2 * F;
    var spread = (m.perSquare[1] - m.perSquare[0]) / (m.perSquare[1] + m.perSquare[0]);
    var w = Math.sqrt(spread * spread + u * u);
    var low = mid * (1 - w);
    var high = mid * (1 + w);
    low = Math.max(low, P.minimumJob);
    mid = Math.max(mid, P.minimumJob * 1.05);
    high = Math.max(high, P.minimumJob * 1.12);
    return { low: r100(low), mid: r100(mid), high: r100(high), squares: sq, F: F, u: u };
  }
  function gapList(squares) {
    return Object.keys(P.competitorGaps).map(function (k) {
      var g = P.competitorGaps[k];
      var cost = g.perSquare ? g.perSquare * squares : (g.flat || 0);
      return { key: k, g: g, status: state.items[k], cost: r50(cost) };
    });
  }

  /* ───────────────────────── navigation ───────────────────────── */

  function go(step, opts) {
    opts = opts || {};
    if (!opts.replace && state.step !== 'measuring' && state.step !== step) state.history.push(state.step);
    state.step = step;
    render(false);
  }
  function back() {
    var prev = state.history.pop();
    while (prev === 'measuring') prev = state.history.pop();
    if (!prev) return;
    state.step = prev;
    render(true);
  }

  function render(isBack, quiet) {
    var s = state.step;
    if (s === 'confirm') state.mode = 'satellite';
    if (s === 'manual') state.mode = 'manual';

    qsa('.step').forEach(function (el) {
      var on = el.getAttribute('data-step') === s;
      el.hidden = !on;
      el.classList.toggle('is-back', !!(on && isBack));
      if (on) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
    });

    var idx = STEP_INDEX[s];
    qsa('#progress li').forEach(function (li, i) {
      li.classList.toggle('is-done', i < idx || (i === idx && s === 'results'));
      li.classList.toggle('is-current', i === idx && s !== 'results');
    });
    var firstLabel = qsa('#progress li')[0];
    if (firstLabel) firstLabel.textContent = state.satelliteAvailable ? 'Address' : 'Home';

    var foot = $('wizFoot');
    var showFoot = ['confirm', 'manual', 'material', 'quote'].indexOf(s) > -1;
    foot.hidden = !showFoot;
    $('backBtn').style.visibility = state.history.length ? 'visible' : 'hidden';
    $('nextBtn').textContent = s === 'quote' ? 'See my estimate →' : 'Continue →';

    $('heroGrid').classList.toggle('is-wide', s === 'results');

    if (s === 'material') renderMaterials(document.querySelector('[data-group="material"]'));
    if (s === 'quote') renderQuoteStep();
    if (s === 'results') renderResults();
    updateRunning();

    if (quiet) return;
    // Keep the card in view and move focus to the new step's heading.
    var card = $('estimator');
    var top = card.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) {
      card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }
    var heading = document.querySelector('.step[data-step="' + s + '"] .step-title, .step[data-step="' + s + '"] .res-range');
    if (heading && s !== 'address') {
      heading.setAttribute('tabindex', '-1');
      try { heading.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
    }
  }

  function updateRunning() {
    var show = ['confirm', 'manual', 'material', 'quote'].indexOf(state.step) > -1;
    $('running').hidden = !show;
    if (!show) return;
    var e = estimate();
    $('runningVal').innerHTML = moneyK(e.low) + ' – ' + moneyK(e.high) +
      (P.pricesConfirmed ? '' : '<span class="draft-flag">DRAFT</span>');
    $('running').querySelector('small').textContent = 'Estimate so far · ' + P.materials[state.material].short;
  }

  function onStateChange(what) {
    if (what === 'hasQuote') {
      $('quoteBox').hidden = state.hasQuote !== 'yes';
      if (state.hasQuote === 'yes') setTimeout(function () { $('quoteAmt').focus(); }, 50);
    }
    if (state.step === 'material') renderMaterials(document.querySelector('[data-group="material"]'));
    updateRunning();
  }

  /* ───────────────────────── step: address / measuring ───────────────────────── */

  function setScan(i) {
    qsa('#scanSteps li').forEach(function (li, n) {
      li.classList.toggle('is-done', n < i);
      li.classList.toggle('is-on', n === i);
    });
  }

  function showNotice(id, html) {
    var n = $(id);
    if (!html) { n.hidden = true; n.innerHTML = ''; return; }
    n.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm.9 12.6H9.1v-1.8h1.8zm0-3.4H9.1V5.9h1.8z"/></svg><span>' + html + '</span>';
    n.hidden = false;
  }

  async function measure(address) {
    state.address = address;
    track('estimator_start', { method: 'address' });
    go('measuring');
    setScan(0);
    var timers = [setTimeout(function () { setScan(1); }, 800), setTimeout(function () { setScan(2); }, 1600)];
    var minWait = sleep(reduceMotion ? 300 : 2300);

    var res;
    try {
      var r = await fetch(API + '?address=' + encodeURIComponent(address), { headers: { accept: 'application/json' } });
      res = await r.json().catch(function () { return { ok: false, reason: 'not_configured' }; });
    } catch (e) {
      res = { ok: false, reason: 'not_configured' };
    }
    await minWait;
    timers.forEach(clearTimeout);

    var sane = res && res.ok && res.roofAreaSqft >= 700 && res.roofAreaSqft <= 12000;
    if (sane) {
      setScan(3);
      state.measure = res;
      state.address = res.address || address;
      state.pitch = pitchKeyFromRise(res.pitchRise);
      state.complexity = complexityFromPlanes(res.segments || 8);
      track('estimator_measured', { squares: Math.round(res.roofAreaSqft / 100), quality: res.quality });
      await sleep(reduceMotion ? 0 : 450);
      renderConfirm();
      state.history = ['address'];
      go('confirm', { replace: true });
      return;
    }

    var reason = res && res.reason;
    if (reason === 'address_not_found' || reason === 'address_not_precise' || reason === 'address_too_short') {
      state.step = 'address';
      state.history = [];
      render(true);
      $('addrErr').textContent = "We couldn't pin down that exact address. Include the street number and city, or use your home size instead.";
      $('addr').setAttribute('aria-invalid', 'true');
      $('addr').focus();
      return;
    }
    var msg = {
      outside_service_area: "That address looks outside our usual service area (Galveston to College Station). You can still get an estimate, and we'll let you know if we can do the job.",
      roof_not_found: "We found your address but couldn't get a clear satellite measurement of the roof. Two quick questions instead.",
      not_configured: "Satellite measuring isn't available right now. A few quick questions will get you the same estimate.",
      lookup_failed: "Satellite measuring isn't available right now. A few quick questions will get you the same estimate."
    }[reason] || "We couldn't get a reliable measurement for that roof. A few quick questions will get you an estimate instead.";
    if (res && res.ok && !sane) msg = "That roof measured outside the range we can estimate online (it may be a commercial or multi-unit building). A few quick questions instead.";
    showNotice('manualNotice', esc(msg));
    state.history = ['address'];
    go('manual', { replace: true });
  }

  function renderConfirm() {
    var m = state.measure;
    $('mArea').textContent = num(m.roofAreaSqft);
    $('mPitch').textContent = m.pitchRise != null ? (Math.round(m.pitchRise) + '/12') : '—';
    $('mPlanes').textContent = m.segments || '—';
    $('satCap').textContent = m.address || state.address;
    var fig = $('satFig'), img = $('satImg');
    fig.classList.remove('no-img');
    img.onerror = function () { fig.classList.add('no-img'); };
    img.src = API + '?image=1&lat=' + encodeURIComponent(m.buildingLat) + '&lng=' + encodeURIComponent(m.buildingLng);

    var notes = [];
    if (m.distanceFromAddressM > 35) notes.push('The closest roof we found is a little off from the address pin. Make sure the circle is on your home.');
    if (m.flatShare > 0.3) notes.push('Part of this roof looks flat or low-slope. Flat sections need different materials and are priced on inspection.');
    if (m.quality && m.quality !== 'HIGH') notes.push("Satellite imagery here is lower resolution, so we've widened your price range a little.");
    showNotice('confirmNotice', notes.map(esc).join('<br>'));
    $('confirmSub').textContent = m.imageryDate
      ? 'Check that the circle is on your home. Imagery from ' + monthName(m.imageryDate) + '.'
      : 'Check that the circle is on your home.';
  }
  function monthName(ym) {
    var p = ym.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  /* ───────────────────────── step: quote ───────────────────────── */

  function renderQuoteStep() {
    var box = $('checks');
    if (!box.dataset.built) {
      box.innerHTML = Object.keys(P.competitorGaps).map(function (k) {
        var g = P.competitorGaps[k], n = 'chk-' + k;
        var opt = function (v, label, cls) {
          return '<label><input type="radio" name="' + n + '" value="' + v + '"><span class="' + cls + '">' + label + '</span></label>';
        };
        return '<div class="chk"><span class="chk-name" id="lbl-' + k + '">' + esc(g.label) + '</span>' +
          '<span class="seg" role="radiogroup" aria-labelledby="lbl-' + k + '">' +
          opt('yes', 'Yes', 'y') + opt('no', 'No', 'n') + opt('unsure', 'Not sure', 'u') + '</span></div>';
      }).join('');
      box.addEventListener('change', function (e) {
        var k = e.target.name.replace('chk-', '');
        state.items[k] = e.target.value;
      });
      box.dataset.built = '1';
    }
    Object.keys(state.items).forEach(function (k) {
      qsa('input[name="chk-' + k + '"]', box).forEach(function (i) { i.checked = i.value === state.items[k]; });
    });
    $('quoteBox').hidden = state.hasQuote !== 'yes';
    if (state.quote) $('quoteAmt').value = num(state.quote);
    $('insurance').checked = state.insurance;
  }

  /* ───────────────────────── step: results ───────────────────────── */

  var ICON = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    scale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M5 21h14M4 8h16M7 8l-3 7a3 3 0 0 0 6 0zM17 8l-3 7a3 3 0 0 0 6 0z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2z"/></svg>'
  };

  function verdict(est, q, gaps) {
    var missing = gaps.filter(function (g) { return g.status === 'no'; });
    var unsure = gaps.filter(function (g) { return g.status === 'unsure'; });
    var add = missing.reduce(function (s, g) { return s + g.cost; }, 0);
    var adj = q + add;
    var mat = P.materials[state.material].name;
    var missTxt = missing.length
      ? ' Their quote also leaves out ' + missing.length + (missing.length === 1 ? ' item' : ' items') + ' Titan includes.'
      : '';
    var v;
    if (q > est.high) {
      v = { cls: 'good', icon: ICON.check,
        title: 'You could save ' + money(q - est.high) + '–' + money(q - est.low),
        text: 'Your quote is above our estimate for a ' + mat + ' roof with a full tear-off, synthetic underlayment, valley protection and all-new flashing.' + missTxt };
    } else if (q >= est.low) {
      v = { cls: 'even', icon: ICON.scale,
        title: 'Your quote is right in our range',
        text: add > 0
          ? 'Same money, different roof. Their quote leaves out ' + missing.length + (missing.length === 1 ? ' item' : ' items') + ' that Titan includes, worth about ' + money(add) + '.'
          : 'Same money, so the difference is in the details: materials, installation and who stands behind the warranty.' };
    } else if (add > 0 && adj >= est.low) {
      v = { cls: 'under', icon: ICON.search,
        title: 'Lower price, less roof',
        text: 'Their quote is ' + money(est.low - q) + ' below our estimate, but it leaves out ' + missing.length + (missing.length === 1 ? ' item' : ' items') + ' Titan includes. Matched to the same spec, it comes to about ' + money(adj) + '.' };
    } else {
      v = { cls: 'under', icon: ICON.search,
        title: 'Their quote is ' + money(est.low - q) + ' lower',
        text: "We'll be straight with you: if it's the same materials and the same install, that's a good price. Before you sign, check the items marked below, or text us a photo of the quote and we'll review it line by line, free." };
    }
    if (q < est.low * 0.45 || q > est.high * 2.5) {
      v.text += ' (That amount is far from typical for this roof size. Double-check that it covers a full replacement of the whole roof.)';
    }
    v.adj = add > 0 ? adj : null;
    v.missing = missing;
    v.unsure = unsure;
    v.add = add;
    return v;
  }

  function renderResults() {
    var est = estimate();
    var mat = P.materials[state.material];
    var f = factors();
    var sqft = roofSqft();
    var isSat = state.mode === 'satellite' && state.measure;
    var gaps = gapList(est.squares);
    var hasQ = state.hasQuote === 'yes' && state.quote;
    var v = hasQ ? verdict(est, state.quote, gaps) : null;

    track('estimator_result', {
      material: state.material, low: est.low, high: est.high, squares: Math.round(est.squares * 10) / 10,
      measured: isSat ? 'satellite' : 'manual', has_quote: !!hasQ,
      verdict: v ? v.cls : 'none'
    });

    var pitchLabel = isSat && state.measure.pitchRise != null
      ? Math.round(state.measure.pitchRise) + '/12 pitch'
      : P.pitch[state.pitch].label + ' pitch (' + P.pitch[state.pitch].range + ')';

    var h = '';
    if (!P.pricesConfirmed) {
      h += '<div class="draft-banner">Draft pricing: these numbers use placeholder rates until Titan confirms its price list.</div>';
    }

    h += '<div class="res-top"><div>' +
      '<div class="eyebrow">Your Titan estimate · ' + esc(mat.name) + '</div>' +
      '<div class="res-range" aria-label="Estimate ' + money(est.low) + ' to ' + money(est.high) + '"><span data-count="' + est.low + '">' + money(est.low) + '</span><span class="dash">–</span><span data-count="' + est.high + '">' + money(est.high) + '</span></div>' +
      '<div class="res-mid">Most likely around <b>' + money(est.mid) + '</b> · about ' + money(est.mid / est.squares) + ' per square, installed</div>' +
      '<div class="chips">' +
        '<span class="chip' + (isSat ? ' sat-chip' : '') + '">' + (isSat ? '🛰 Satellite-measured' : 'Estimated from home size') + '</span>' +
        '<span class="chip">' + num(sqft) + ' sq ft roof · ' + (Math.round(est.squares * 10) / 10) + ' squares</span>' +
        '<span class="chip">' + esc(pitchLabel) + '</span>' +
        '<span class="chip">' + esc(P.complexity[state.complexity].label) + ' roof</span>' +
        '<span class="chip">' + state.stories + (state.stories === '1' ? ' story' : ' stories') + '</span>' +
      '</div></div>' +
      '<div class="res-actions">' +
        '<button type="button" class="btn btn-ghost" data-act="back">← Edit answers</button>' +
        '<button type="button" class="btn btn-ghost" data-act="print">Save or print</button>' +
        '<button type="button" class="btn btn-ghost" data-act="restart">Start over</button>' +
      '</div></div>';

    if (v) {
      h += '<div class="cmp">' +
        '<div class="verdict ' + v.cls + '"><div class="verdict-ico">' + v.icon + '</div><div><h3>' + esc(v.title) + '</h3><p>' + esc(v.text) + '</p></div></div>' +
        '<div class="chart-wrap"><div class="chart-title">Their quote vs. Titan\'s estimate range</div><div id="chart"></div></div>' +
        '<div class="persq' + (v.add > 0 ? '' : ' two') + '">' +
          '<div><b>' + money(state.quote / est.squares) + '</b><span>Their price per square</span></div>' +
          '<div><b>' + money(est.mid / est.squares) + '</b><span>Titan per square (most likely)</span></div>' +
          (v.add > 0 ? '<div><b>' + money(v.adj / est.squares) + '</b><span>Theirs, matched to Titan spec</span></div>' : '') +
        '</div>' +
        specTable(gaps) +
      '</div>';
    } else {
      h += '<div class="cmp"><div class="verdict even"><div class="verdict-ico">' + ICON.shield + '</div><div>' +
        '<h3>Getting other quotes? Bring them back.</h3>' +
        '<p>Run this again with their number and we\'ll show you the gap line by line. Or text a photo of the quote to ' + esc(P.contact.name) + ' at ' + esc(P.contact.phoneDisplay) + ' and we\'ll review it for free.</p>' +
        '</div></div>' + specTable(gaps, true) + '</div>';
    }

    if (state.insurance) {
      h += '<div class="ins-note">' + ICON.shield + '<span><b>Storm damage?</b> If your insurer approves a claim, you typically pay only your deductible and insurance covers the rest. We document the damage and meet your adjuster on site. <a href="/storm-damage.html">How storm claims work →</a></span></div>';
    }

    var rows = [
      ['Roof surface', num(sqft) + ' sq ft' + (isSat ? ' (satellite)' : ' (from home size)')],
      ['Roofing squares', (Math.round(est.squares * 10) / 10) + ' × 100 sq ft'],
      [mat.short, money(mat.perSquare[0]) + '–' + money(mat.perSquare[1]) + ' / square'],
      ['Pitch', f.pitch === 1 ? 'No adjustment' : pct(f.pitch)],
      ['Roof shape', f.complexity === 1 ? 'No adjustment' : pct(f.complexity)],
      ['Stories', f.stories === 1 ? 'No adjustment' : pct(f.stories)],
      ['Measurement margin', '±' + Math.round(est.u * 100) + '% (' + (isSat ? 'satellite' : 'home size') + ')'],
      ['Your estimate', money(est.low) + ' – ' + money(est.high)]
    ];
    h += '<div class="res-grid">' +
      '<div class="res-card"><h4>How we got this number</h4>' + rows.map(function (r) {
        return '<div class="math-row"><span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span></div>';
      }).join('') + '</div>' +
      '<div class="res-card"><h4>Included in every Titan roof</h4><ul class="ticks">' +
        '<li>Full tear-off to bare decking and a deck inspection</li>' +
        '<li>Synthetic underlayment, not felt</li>' +
        '<li>Ice &amp; water shield in every valley</li>' +
        '<li>All-new pipe boots and flashing</li>' +
        '<li>4 nails per shingle in the manufacturer\'s zone</li>' +
        '<li>Permit, haul-off and full cleanup</li>' +
        '<li>Titan workmanship warranty, installed by our own crews</li>' +
      '</ul></div>' +
      '<div class="res-card"><h4>What could change the final price</h4><ul class="ticks plus">' +
        '<li>Rotten decking found after tear-off (priced per sheet, shown to you first)</li>' +
        '<li>A second layer of old shingles to remove</li>' +
        '<li>Chimney, skylight or wall flashing rebuilds</li>' +
        '<li>Ventilation upgrades</li>' +
        '<li>Gutters (not included)</li>' +
      '</ul></div>' +
    '</div>';

    h += leadBlock(est);

    h += '<p class="res-fine">This is a planning estimate, not a bid or a contract. It assumes one existing layer of shingles and sound decking. ' +
      'Your firm price is set after a free on-site inspection. "Matched to Titan spec" figures are typical costs for the missing items, not a quote from the other contractor. ' +
      'Pricing reviewed ' + esc(P.lastReviewed) + '.</p>';

    $('results').innerHTML = h;

    if (v) drawChart(est, state.quote, v.adj);
    bindResults(est);
    countUp();
  }

  function specTable(gaps, titanOnly) {
    var head = titanOnly
      ? '<caption>Questions to ask every roofer</caption><thead><tr><th scope="col">Item</th><th scope="col">Ask them</th><th scope="col">Titan</th></tr></thead>'
      : '<caption>What\'s in each quote</caption><thead><tr><th scope="col">Item</th><th scope="col">Their quote</th><th scope="col">Titan</th></tr></thead>';
    var body = gaps.map(function (x) {
      var cell;
      if (titanOnly) {
        cell = '<span class="row-note">' + esc(x.g.ask) + '</span>';
      } else if (x.status === 'yes') {
        cell = '<span class="tag y">✓ Included</span>';
      } else if (x.status === 'no') {
        cell = '<span class="tag n">✗ Not included' + (x.cost > 0 ? ' · +' + money(x.cost) + ' to match' : '') + '</span><span class="row-note">' + esc(x.g.ifMissing) + '</span>';
      } else {
        cell = '<span class="tag u">? Ask them</span><span class="row-note">' + esc(x.g.ask) + '</span>';
      }
      return '<tr><th scope="row">' + esc(x.g.label) + '</th><td>' + cell + '</td><td class="titan">✓ Included</td></tr>';
    }).join('');
    return '<table class="spec-table">' + head + '<tbody>' + body + '</tbody></table>';
  }

  function leadBlock(est) {
    var c = P.contact;
    if (state.leadSent) {
      return '<div class="lead"><div class="lead-pitch"><h3>You\'re all set</h3><p>We have your estimate and details.</p></div>' +
        '<div class="lead-form">' + leadSuccess() + '</div></div>';
    }
    var needAddress = !(state.mode === 'satellite' && state.measure);
    return '<div class="lead" id="lead">' +
      '<div class="lead-pitch">' +
        '<h3>Turn this into a <em>firm written bid</em></h3>' +
        '<p>Online numbers get you close. A free inspection gets you a price you can sign.</p>' +
        '<ol><li>' + esc(c.name) + ' calls to set a time that suits you</li><li>We walk the roof, check the decking and confirm measurements</li><li>You get a written bid. No pressure, no obligation</li></ol>' +
        '<div class="lead-alt">' +
          '<a href="tel:' + esc(c.phoneTel) + '">' + ICON.phone + 'Call ' + esc(c.phoneDisplay) + '</a>' +
          '<a href="sms:' + esc(c.phoneTel) + '">' + ICON.chat + 'Text a photo of your quote</a>' +
        '</div>' +
      '</div>' +
      '<form class="lead-form" id="leadForm" novalidate>' +
        '<div class="fld"><label for="leadName">Name</label><input id="leadName" autocomplete="name" required></div>' +
        '<div class="row2">' +
          '<div class="fld"><label for="leadPhone">Phone</label><input id="leadPhone" type="tel" autocomplete="tel" inputmode="tel" placeholder="(281) 555-1234"></div>' +
          '<div class="fld"><label for="leadEmail">Email <small>(optional)</small></label><input id="leadEmail" type="email" autocomplete="email" placeholder="you@example.com"></div>' +
        '</div>' +
        (needAddress ? '<div class="fld"><label for="leadAddr">Property address</label><input id="leadAddr" autocomplete="street-address" placeholder="Street, city"></div>' : '') +
        '<input class="hp" id="leadHp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
        '<p class="field-error" id="leadErr" role="alert"></p>' +
        '<button type="submit" class="btn btn-primary btn-block" id="leadBtn">Get my firm bid →</button>' +
        '<p class="lead-fine">We\'ll only use this to schedule your inspection. Your estimate (' + money(est.low) + '–' + money(est.high) + ') is sent with it.</p>' +
      '</form>' +
    '</div>';
  }
  function leadSuccess() {
    return '<div class="lead-ok"><div class="big-check">' + ICON.check + '</div><h4>Got it. Talk soon.</h4>' +
      '<p>' + esc(P.contact.name) + ' will reach out to schedule your free inspection. Want to move faster? Call or text ' +
      '<a href="tel:' + esc(P.contact.phoneTel) + '">' + esc(P.contact.phoneDisplay) + '</a>.</p></div>';
  }

  function bindResults(est) {
    qsa('[data-act]', $('results')).forEach(function (b) {
      b.addEventListener('click', function () {
        var a = b.getAttribute('data-act');
        if (a === 'back') back();
        if (a === 'print') { track('estimator_print'); window.print(); }
        if (a === 'restart') restart();
      });
    });
    var form = $('leadForm');
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); submitLead(est); });
  }

  async function submitLead(est) {
    var name = $('leadName').value.trim();
    var phone = $('leadPhone').value.trim();
    var email = $('leadEmail').value.trim();
    var addrEl = $('leadAddr');
    var address = addrEl ? addrEl.value.trim() : state.address;
    var err = $('leadErr');
    qsa('#leadForm input').forEach(function (i) { i.removeAttribute('aria-invalid'); });

    var phoneDigits = phone.replace(/\D/g, '');
    if (!name) { err.textContent = 'Please add your name.'; $('leadName').setAttribute('aria-invalid', 'true'); $('leadName').focus(); return; }
    if (phoneDigits.length < 10 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      err.textContent = 'Add a phone number (or an email) so we can reach you.';
      $('leadPhone').setAttribute('aria-invalid', 'true'); $('leadPhone').focus(); return;
    }
    err.textContent = '';

    var btn = $('leadBtn');
    btn.disabled = true; btn.textContent = 'Sending…';

    var gaps = gapList(est.squares);
    var isSat = state.mode === 'satellite' && state.measure;
    var payload = {
      _subject: 'Estimator lead — ' + name + (address ? ' — ' + address : ''),
      _template: 'table',
      _captcha: 'false',
      'Name': name,
      'Phone': phone,
      'Email': email,
      'Address': address,
      'Titan estimate': money(est.low) + ' – ' + money(est.high) + ' (most likely ' + money(est.mid) + ')',
      'Material': P.materials[state.material].name,
      'Roof size': num(roofSqft()) + ' sq ft (' + (Math.round(est.squares * 10) / 10) + ' squares)',
      'Measured by': isSat ? 'Satellite (' + state.measure.quality + ' imagery, ' + state.measure.segments + ' planes)' : 'Homeowner answers: ' + num(state.homeSqft) + ' sq ft home, garage ' + state.garage,
      'Pitch': isSat && state.measure.pitchRise != null ? Math.round(state.measure.pitchRise) + '/12' : P.pitch[state.pitch].label,
      'Roof shape': P.complexity[state.complexity].label,
      'Stories': state.stories,
      'Other quote': state.hasQuote === 'yes' && state.quote ? money(state.quote) : 'None entered',
      'Other quote is missing': gaps.filter(function (g) { return g.status === 'no'; }).map(function (g) { return g.g.label; }).join(', ') || '—',
      'Homeowner unsure about': gaps.filter(function (g) { return g.status === 'unsure'; }).map(function (g) { return g.g.label; }).join(', ') || '—',
      'Storm / insurance': state.insurance ? 'Yes' : 'No',
      'Pricing status': P.pricesConfirmed ? 'Confirmed' : 'DRAFT placeholder pricing',
      'Page': location.href
    };

    if ($('leadHp') && $('leadHp').value) { leadDone(); return; } // bot filled the hidden field

    try {
      var r = await fetch('https://formsubmit.co/ajax/' + encodeURIComponent(P.contact.email), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok || String(data.success) !== 'true') throw new Error('send failed');
      track('estimator_lead', { material: state.material, low: est.low, high: est.high, has_quote: state.hasQuote === 'yes' });
      leadDone();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Get my firm bid →';
      err.innerHTML = "That didn't go through. Please call or text " + esc(P.contact.name) + ' at <a href="tel:' + esc(P.contact.phoneTel) + '">' + esc(P.contact.phoneDisplay) + '</a>.';
    }
  }
  function leadDone() {
    state.leadSent = true;
    var form = $('leadForm');
    if (form) form.outerHTML = '<div class="lead-form">' + leadSuccess() + '</div>';
  }

  function countUp() {
    if (reduceMotion) return;
    qsa('[data-count]', $('results')).forEach(function (el) {
      var target = Number(el.getAttribute('data-count')), start = target * 0.82, t0 = null, dur = 750;
      function frame(t) {
        if (!t0) t0 = t;
        var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        el.textContent = money(r100(start + (target - start) * e));
        if (p < 1) requestAnimationFrame(frame); else el.textContent = money(target);
      }
      requestAnimationFrame(frame);
    });
  }

  /* ───────────────────────── chart ───────────────────────── */

  var lastChart = null;
  function drawChart(est, q, adj) {
    lastChart = { est: est, q: q, adj: adj };
    var host = $('chart');
    if (!host) return;
    var W = Math.max(280, host.clientWidth);
    var small = W < 460;
    var fs = small ? 12 : 13;
    var vals = [est.low, est.high, q].concat(adj ? [adj] : []);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = Math.max((hi - lo) * 0.22, hi * 0.06);
    var d0 = Math.max(0, lo - pad), d1 = hi + pad;
    var L = 8, R = 8;
    var x = function (v) { return L + (v - d0) / (d1 - d0) * (W - L - R); };

    var yQlab = 16, yQ = 30, bandY = 44, bandH = 22, yT = 88, yA = adj ? 112 : 0, yAlab = adj ? 132 : 0;
    var axisY = adj ? 150 : 110, H = axisY + 22;

    // Nice ticks
    var span = d1 - d0, steps = [500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000], step = steps[steps.length - 1];
    for (var i = 0; i < steps.length; i++) { if (span / steps[i] <= (small ? 4 : 6)) { step = steps[i]; break; } }
    var ticks = '';
    for (var t = Math.ceil(d0 / step) * step; t <= d1; t += step) {
      ticks += '<line x1="' + x(t) + '" x2="' + x(t) + '" y1="' + (bandY - 6) + '" y2="' + axisY + '" stroke="#EEF0F3" stroke-width="1"/>' +
        '<text x="' + x(t) + '" y="' + (axisY + 16) + '" text-anchor="middle" font-size="' + (fs - 1) + '" fill="#6B7280">' + moneyK(t) + '</text>';
    }

    function anchor(px, textW) {
      if (px - textW / 2 < 2) return { a: 'start', x: Math.max(2, px - 10) };
      if (px + textW / 2 > W - 2) return { a: 'end', x: Math.min(W - 2, px + 10) };
      return { a: 'middle', x: px };
    }
    var halo = ' paint-order="stroke" stroke="#fff" stroke-width="5" stroke-linejoin="round"';

    var bx0 = x(est.low), bx1 = x(est.high), bm = x(est.mid);
    var tLabel = 'Titan  ' + moneyK(est.low) + ' – ' + moneyK(est.high);
    var tA = anchor((bx0 + bx1) / 2, tLabel.length * fs * 0.56);

    var qx = x(q);
    var qLabel = 'Their quote ' + money(q);
    var qA = anchor(qx, qLabel.length * fs * 0.56);

    var svg = '<svg class="rchart" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc('Titan estimate ' + money(est.low) + ' to ' + money(est.high) + '. Their quote ' + money(q) + (adj ? '. Their quote matched to Titan spec about ' + money(adj) : '') + '.') + '">' +
      ticks +
      '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + axisY + '" y2="' + axisY + '" stroke="#D1D5DB"/>' +
      // Titan band
      '<rect x="' + bx0 + '" y="' + bandY + '" width="' + Math.max(4, bx1 - bx0) + '" height="' + bandH + '" rx="4" fill="#1B2A4A"/>' +
      '<line x1="' + bm + '" x2="' + bm + '" y1="' + (bandY + 4) + '" y2="' + (bandY + bandH - 4) + '" stroke="#D4A853" stroke-width="2.5" stroke-linecap="round"/>' +
      '<text x="' + tA.x + '" y="' + yT + '" text-anchor="' + tA.a + '" font-size="' + fs + '" font-weight="700" fill="#1B2A4A"' + halo + '>' + esc(tLabel) + '</text>' +
      // Their quote marker
      '<line x1="' + qx + '" x2="' + qx + '" y1="' + yQ + '" y2="' + (bandY + bandH + 6) + '" stroke="#111827" stroke-width="2"/>' +
      '<path d="M' + qx + ' ' + (yQ - 7) + ' l7 7 -7 7 -7 -7z" fill="#111827" stroke="#fff" stroke-width="2"/>' +
      '<text x="' + qA.x + '" y="' + (yQlab - 4) + '" text-anchor="' + qA.a + '" font-size="' + fs + '" font-weight="700" fill="#111827"' + halo + '>' + esc(qLabel) + '</text>';

    if (adj) {
      var ax = x(adj);
      var aLabel = 'Matched to Titan spec ≈ ' + money(adj);
      var aA = anchor(ax, aLabel.length * fs * 0.52);
      svg += '<line x1="' + ax + '" x2="' + ax + '" y1="' + (bandY - 2) + '" y2="' + (yA - 8) + '" stroke="#6B7280" stroke-width="1.5" stroke-dasharray="3 3"/>' +
        '<path d="M' + ax + ' ' + (yA - 7) + ' l7 7 -7 7 -7 -7z" fill="#fff" stroke="#374151" stroke-width="2"/>' +
        '<text x="' + aA.x + '" y="' + (yAlab + 2) + '" text-anchor="' + aA.a + '" font-size="' + (fs - 0.5) + '" font-weight="600" fill="#374151"' + halo + '>' + esc(aLabel) + '</text>';
      if (Math.abs(ax - qx) > 3) {
        svg += '<path d="M' + qx + ' ' + (yA) + ' H' + (ax - 9) + '" stroke="#B42318" stroke-width="1.5" marker-end="url(#arr)" opacity="0.7"/>';
      }
    }
    svg += '<defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8z" fill="#B42318"/></marker></defs>';

    // Hover targets (bigger than the marks)
    svg += '<rect class="hit" x="' + bx0 + '" y="' + (bandY - 4) + '" width="' + Math.max(16, bx1 - bx0) + '" height="' + (bandH + 8) + '" fill="transparent" data-tip="' +
      esc('<b>Titan estimate</b>' + money(est.low) + ' – ' + money(est.high) + '<br>Most likely ' + money(est.mid)) + '"/>';
    svg += '<rect class="hit" x="' + (qx - 14) + '" y="' + (yQ - 16) + '" width="28" height="' + (bandY + bandH - yQ + 22) + '" fill="transparent" data-tip="' +
      esc('<b>Their quote</b>' + money(q) + '<br>' + money(q / est.squares) + ' per square') + '"/>';
    if (adj) {
      svg += '<rect class="hit" x="' + (x(adj) - 14) + '" y="' + (yA - 14) + '" width="28" height="28" fill="transparent" data-tip="' +
        esc('<b>Matched to Titan spec</b>≈ ' + money(adj) + '<br>Their quote + typical cost of the missing items') + '"/>';
    }
    svg += '</svg>';
    host.innerHTML = svg;
    bindTips(host);
  }

  function bindTips(root) {
    var tip = $('tip');
    function show(e, el) {
      tip.innerHTML = el.getAttribute('data-tip');
      tip.style.left = e.pageX + 'px';
      tip.style.top = e.pageY + 'px';
      tip.classList.add('is-on');
    }
    qsa('.hit', root).forEach(function (el) {
      el.addEventListener('pointerenter', function (e) { show(e, el); });
      el.addEventListener('pointermove', function (e) { show(e, el); });
      el.addEventListener('pointerdown', function (e) { show(e, el); });
      el.addEventListener('pointerleave', function () { tip.classList.remove('is-on'); });
    });
  }

  var resizeT;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      if (state.step === 'results' && lastChart) drawChart(lastChart.est, lastChart.q, lastChart.adj);
    }, 120);
  });
  document.addEventListener('scroll', function () { $('tip').classList.remove('is-on'); }, { passive: true });

  /* ───────────────────────── wiring ───────────────────────── */

  function restart() {
    state.history = [];
    state.measure = null;
    state.mode = null;
    state.hasQuote = null;
    state.quote = null;
    state.leadSent = false;
    $('quoteAmt').value = '';
    $('addr').value = '';
    showNotice('manualNotice', '');
    state.step = state.satelliteAvailable ? 'address' : 'manual';
    render(true);
  }

  function next() {
    var s = state.step;
    if (s === 'confirm' || s === 'manual') {
      if (s === 'manual') track('estimator_start', { method: 'manual' });
      return go('material');
    }
    if (s === 'material') return go('quote');
    if (s === 'quote') {
      state.insurance = $('insurance').checked;
      if (state.hasQuote === 'yes') {
        var raw = $('quoteAmt').value;
        var q = digits(raw);
        if (/k\s*$/i.test(raw.trim()) && q < 1000) q *= 1000;
        if (!(q >= 2000 && q <= 250000)) {
          $('quoteErr').textContent = 'Enter their total price for the whole roof, for example 16,500.';
          $('quoteAmt').setAttribute('aria-invalid', 'true');
          $('quoteAmt').focus();
          return;
        }
        state.quote = Math.round(q);
      } else {
        state.quote = null;
      }
      $('quoteErr').textContent = '';
      return go('results');
    }
  }

  function init() {
    renderGroups();

    $('addrForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('addr').value.trim();
      $('addr').removeAttribute('aria-invalid');
      $('addrErr').textContent = '';
      if (v.length < 6 || !/\d/.test(v)) {
        $('addrErr').textContent = 'Enter your street address with house number, for example 123 Oak St, Conroe.';
        $('addr').setAttribute('aria-invalid', 'true');
        $('addr').focus();
        return;
      }
      measure(v);
    });

    qsa('[data-go]').forEach(function (b) {
      b.addEventListener('click', function () {
        showNotice('manualNotice', '');
        go(b.getAttribute('data-go'));
      });
    });

    $('nextBtn').addEventListener('click', next);
    $('backBtn').addEventListener('click', back);

    // Home size slider + number box stay in sync.
    var range = $('homeSize'), box = $('homeSizeNum');
    function setSize(v, from) {
      v = Math.max(600, Math.min(9000, Math.round(v)));
      state.homeSqft = v;
      if (from !== 'range') range.value = Math.max(Number(range.min), Math.min(Number(range.max), v));
      if (from !== 'box') box.value = num(v);
      var fill = (Number(range.value) - Number(range.min)) / (Number(range.max) - Number(range.min)) * 100;
      range.style.setProperty('--fill', fill + '%');
      updateRunning();
    }
    range.addEventListener('input', function () { setSize(Number(range.value), 'range'); });
    box.addEventListener('input', function () { var v = digits(box.value); if (v >= 600) setSize(v, 'box'); });
    box.addEventListener('blur', function () { setSize(digits(box.value) || state.homeSqft); });
    setSize(state.homeSqft);

    // Quote amount: format as the user types.
    $('quoteAmt').addEventListener('input', function (e) {
      var el = e.target, raw = el.value;
      if (/k/i.test(raw)) return;
      var d = raw.replace(/[^0-9]/g, '').slice(0, 7);
      el.value = d ? Number(d).toLocaleString('en-US') : '';
      el.removeAttribute('aria-invalid');
      $('quoteErr').textContent = '';
    });
    $('quoteAmt').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); next(); } });
    $('insurance').addEventListener('change', function (e) { state.insurance = e.target.checked; });

    render(false, true);

    // Is satellite measuring set up? The probe makes no Google call.
    fetch(API + '?probe=1', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (!d || !d.configured) disableSatellite(); })
      .catch(disableSatellite);
  }

  function disableSatellite() {
    state.satelliteAvailable = false;
    if (state.step === 'address' && !$('addr').value) {
      state.step = 'manual';
      state.history = [];
      render(false, true);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

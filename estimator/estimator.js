/*
 * Titan Roofing — Instant Estimate + quote comparison.
 * Pricing lives in pricing-config.js. This file is behavior only.
 *
 * Three ways in:
 *   address -> satellite measurement (Netlify function) -> confirm -> shingle -> quote -> results
 *   manual  -> home size questions                       -> shingle -> quote -> results
 *   upload  -> read a competitor's estimate (PDF/text)   -> details           -> results
 */
(function () {
  'use strict';

  var P = window.TITAN_PRICING;
  if (!P) return;

  var $ = function (id) { return document.getElementById(id); };
  var qsa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var API = '/api/roof-measure';
  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  var STEP_INDEX = { address: 0, measuring: 0, upload: 0, confirm: 1, manual: 1, details: 1, material: 2, quote: 3, results: 4 };
  var FLOW_STEPS = ['confirm', 'manual', 'details', 'material', 'quote', 'upload'];

  var state = {
    step: 'address',
    history: [],
    satelliteAvailable: true,
    roofSource: null,        // 'satellite' | 'manual' | 'quote'
    address: '',
    measure: null,
    homeSqft: 2200,
    stories: '1',
    garage: 'yes',
    complexity: 'standard',
    pitch: 'standard',
    material: P.defaultMaterial,
    tier: P.defaultMaterial, // shingle type in the competitor's quote
    hasQuote: null,
    quote: null,
    quoteSquares: null,
    quoteParsed: false,
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
  function r50(n) { return Math.round(n / 50) * 50; }
  function r100(n) { return Math.round(n / 100) * 100; }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function moneyK(n) {
    var k = n / 1000;
    return '$' + (k >= 100 ? Math.round(k) : (Math.round(k * 10) / 10)).toString() + 'k';
  }
  function num(n) { return Math.round(n).toLocaleString('en-US'); }
  function sq1(n) { return (Math.round(n * 10) / 10).toString(); }
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

  function seeded(seed) {
    var s = 0;
    for (var i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  /* ───────────────────────── icons ───────────────────────── */

  function storyIcon(n) {
    var h = 6 + n * 11, y = 41 - h, apex = y - 11, wins = '';
    for (var r = 0; r < n; r++) {
      var wy = 41 - (r + 1) * 11 + 2;
      wins += '<rect x="27" y="' + wy + '" width="6" height="5"/><rect x="39" y="' + wy + '" width="6" height="5"/>';
    }
    return '<svg viewBox="0 0 72 44" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M17 ' + y + ' L36 ' + apex + ' L55 ' + y + '"/><rect x="21" y="' + y + '" width="30" height="' + h + '"/>' +
      '<g stroke-width="1.5">' + wins + '</g><path d="M8 41 H64" stroke="#D1D5DB"/></svg>';
  }
  function shapeIcon(k) {
    var a = '<svg viewBox="0 0 72 44" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">';
    var red = ' stroke="#C41E3A" stroke-width="1.8"';
    if (k === 'simple') return a + '<rect x="10" y="7" width="52" height="30"/><path d="M10 22 H62"' + red + '/></svg>';
    if (k === 'standard') return a + '<rect x="10" y="7" width="52" height="30"/><path d="M24 22 H48 M10 7 L24 22 L10 37 M62 7 L48 22 L62 37"' + red + '/></svg>';
    return a + '<path d="M6 5 H44 V18 H66 V40 H28 V27 H6 Z"/><path d="M14 16 H34 M6 5 L14 16 L6 27 M44 5 L34 16 L28 22 M38 29 H56 M66 18 L56 29 L66 40 M28 27 L38 29 M44 18 L38 29"' + red + '/></svg>';
  }
  function pitchIcon(key) {
    var rise = { low: 3.5, standard: 6, steep: 9, vsteep: 12 }[key] || 6;
    var h = Math.min(30, rise / 12 * 28), y = 38 - h;
    return '<svg viewBox="0 0 72 44" fill="none" aria-hidden="true">' +
      '<path d="M8 38 L36 ' + y.toFixed(1) + ' L64 38 Z" fill="#E8EDF5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M36 38 V' + y.toFixed(1) + '" stroke="#C41E3A" stroke-width="1.5" stroke-dasharray="2 3"/></svg>';
  }
  function swatchSVG(key, m) {
    var c = m.swatch, W = 120, H = 100, rnd = seeded(key), out = '';
    out += '<rect width="' + W + '" height="' + H + '" fill="' + c.dark + '"/>';
    var cols = [c.base, c.light, c.dark, c.base];
    for (var row = 0, yy = -4; yy < H; row++, yy += 13) {
      var xx = c.flat ? (row % 2 ? -9 : 0) : -Math.floor(rnd() * 22);
      while (xx < W) {
        var w = c.flat ? 18 : 14 + Math.floor(rnd() * 20);
        var col = c.flat ? c.base : cols[Math.floor(rnd() * cols.length)];
        out += '<rect x="' + xx + '" y="' + yy + '" width="' + (w - 1.5) + '" height="12" fill="' + col + '"/>';
        if (!c.flat && rnd() > 0.55) out += '<rect x="' + xx + '" y="' + (yy + 7) + '" width="' + (w - 1.5) + '" height="5" fill="' + c.dark + '" opacity="0.45"/>';
        xx += w;
      }
      out += '<rect x="0" y="' + (yy + 12) + '" width="' + W + '" height="1.2" fill="#000" opacity="0.35"/>';
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + out + '</svg>';
  }

  /* ───────────────────────── option groups ───────────────────────── */

  var GROUPS = {
    stories: [
      { v: '1', name: '1 story', icon: storyIcon(1) },
      { v: '2', name: '2 stories', icon: storyIcon(2) },
      { v: '3', name: '3+ stories', icon: storyIcon(3) }
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
      return { v: k, name: p.label, meta: p.range + ' · ' + p.note, icon: pitchIcon(k) };
    }),
    tier: Object.keys(P.materials).map(function (k) {
      return { v: k, name: P.materials[k].short };
    }),
    hasQuote: [
      { v: 'yes', name: 'Yes, compare it', meta: 'Type it in or upload it' },
      { v: 'no', name: 'Not yet', meta: 'Just show my estimate' }
    ]
  };

  var groupCounter = 0;
  function renderGroups() {
    qsa('[data-group]').forEach(function (box) {
      var g = box.getAttribute('data-group');
      if (g === 'material' || box.dataset.built) return;
      var name = 'g-' + g + '-' + (groupCounter++);
      box.setAttribute('role', 'radiogroup');
      box.innerHTML = GROUPS[g].map(function (o) {
        return '<label class="opt' + (o.icon ? '' : ' compact') + '"><input type="radio" name="' + name + '" value="' + o.v + '">' +
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
    });
    syncGroups();
  }
  function syncGroups() {
    qsa('[data-group]').forEach(function (box) {
      var g = box.getAttribute('data-group');
      if (g === 'material') return;
      qsa('input[type=radio]', box).forEach(function (i) { i.checked = String(state[g]) === i.value; });
    });
  }

  function renderMaterials() {
    var box = document.querySelector('[data-group="material"]');
    var keys = Object.keys(P.materials);
    if (!box.dataset.built) {
      box.setAttribute('role', 'radiogroup');
      box.innerHTML = keys.map(function (k) {
        var m = P.materials[k];
        return '<label class="opt mat"><input type="radio" name="g-material" value="' + k + '">' +
          '<span class="opt-face"><span class="mat-swatch">' + swatchSVG(k, m) + '<span class="mat-badge">' + esc(m.badge) + '</span></span>' +
          '<span class="mat-body"><span class="mat-top"><span class="opt-name">' + esc(m.name) + '</span>' +
          '<span class="mat-price" data-price="' + k + '">–</span></span>' +
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
    $('matDetail').innerHTML = '<b>' + esc(m.short) + ':</b> typical Houston pricing for this tier is ' + money(m.market[0]) + '–' + money(m.market[1]) +
      ' per square. Titan: ' + money(m.low) + '–' + money(m.high) + '.' +
      '<ul>' + m.specs.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
  }

  /* "What's included" checklists (quote step and upload step share state). */
  function renderChecks() {
    qsa('[data-checks]').forEach(function (box, bi) {
      if (!box.dataset.built) {
        box.innerHTML = Object.keys(P.competitorGaps).map(function (k) {
          var g = P.competitorGaps[k], n = 'chk' + bi + '-' + k, id = 'lbl' + bi + '-' + k;
          var opt = function (v, label, cls) {
            return '<label><input type="radio" name="' + n + '" value="' + v + '" data-item="' + k + '"><span class="' + cls + '">' + label + '</span></label>';
          };
          return '<div class="chk"><span class="chk-name" id="' + id + '">' + esc(g.label) + '</span>' +
            '<span class="seg" role="radiogroup" aria-labelledby="' + id + '">' +
            opt('yes', 'Yes', 'y') + opt('no', 'No', 'n') + opt('unsure', 'Not sure', 'u') + '</span></div>';
        }).join('');
        box.addEventListener('change', function (e) {
          var k = e.target.getAttribute('data-item');
          if (k) { state.items[k] = e.target.value; renderChecks(); }
        });
        box.dataset.built = '1';
      }
      qsa('input[type=radio]', box).forEach(function (i) {
        i.checked = state.items[i.getAttribute('data-item')] === i.value;
      });
    });
  }

  /* ───────────────────────── pricing ───────────────────────── */

  function pitchKeyFromRise(r) {
    if (r == null) return 'standard';
    var keys = Object.keys(P.pitch);
    for (var i = 0; i < keys.length; i++) if (r <= P.pitch[keys[i]].maxRise) return keys[i];
    return 'standard';
  }
  function complexityFromPlanes(n) { return n <= 6 ? 'simple' : n <= 14 ? 'standard' : 'complex'; }

  function roofSqft() {
    if (state.roofSource === 'quote' && state.quoteSquares) return state.quoteSquares * 100;
    if (state.roofSource === 'satellite' && state.measure) return state.measure.roofAreaSqft;
    var footprint = state.homeSqft / (P.storyDivisor[state.stories] || 1) + (state.garage === 'yes' ? P.garageFootprint : 0);
    return footprint * P.pitch[state.pitch].areaFactor;
  }
  function factors() {
    return {
      stories: P.stories[state.stories] || 1,
      complexity: P.complexity[state.complexity].factor,
      pitch: P.pitch[state.pitch].factor
    };
  }
  function estimate(matKey) {
    var m = P.materials[matKey || state.material];
    var sq = roofSqft() / 100;
    var f = factors(), mult = f.stories * f.complexity * f.pitch;
    var low = Math.max(P.minimumJob, r50(m.low * mult * sq));
    var high = Math.max(P.minimumJob * 1.12, r50(m.high * mult * sq));
    return {
      squares: sq, mult: mult,
      low: low, high: high, mid: r100((low + high) / 2),
      lowPerSq: Math.round(m.low * mult), highPerSq: Math.round(m.high * mult),
      marketLow: r100(m.market[0] * mult * sq), marketHigh: r100(m.market[1] * mult * sq),
      marketLowPerSq: Math.round(m.market[0] * mult), marketHighPerSq: Math.round(m.market[1] * mult)
    };
  }
  function gapList(squares) {
    return Object.keys(P.competitorGaps).map(function (k) {
      var g = P.competitorGaps[k];
      var cost = g.perSquare ? g.perSquare * squares : (g.flat || 0);
      return { key: k, g: g, status: state.items[k], cost: r50(cost) };
    });
  }

  /* ───────────────────────── competitor estimate reader ───────────────────────── */

  function parseEstimateText(raw) {
    var text = String(raw || '').replace(/\s+/g, ' ');
    var lower = text.toLowerCase();
    var out = { squares: null, total: null, tier: null, stories: null, pitchRise: null, items: {} };

    // Squares: capital "SQ" is roofing shorthand. Lowercase "sq ft" is square
    // footage and is deliberately ignored (it once matched 850 out of "2,850 sq ft").
    var m = text.match(/(\d{1,3}(?:\.\d{1,2})?)\s*SQ(?![a-zA-Z])/) || text.match(/(\d{1,3}(?:\.\d{1,2})?)\s*squares?\b/i);
    if (m) { var s = parseFloat(m[1]); if (s >= 8 && s <= 200) out.squares = s; }
    if (!out.squares) {
      var ft = text.match(/roof\s*(?:size|area)[^0-9$]{0,20}([\d,]{3,6})\s*sq\.?\s*f(?:ee)?t/i);
      if (ft) { var f = digits(ft[1]) / 100; if (f >= 8 && f <= 200) out.squares = Math.round(f * 10) / 10; }
    }

    // Total: needs a $ right after, so a bare "Total" column header is skipped.
    var pats = [
      /(?:rounded|grand|final|contract|estimate|project)\s+total[:\s]*\$\s?([\d,]+(?:\.\d{2})?)/i,
      /(?:RCV|replacement\s+cost\s+value)[:\s]*\$\s?([\d,]+(?:\.\d{2})?)/i,
      /total[:\s]*\$\s?([\d,]+\.\d{2})/i,
      /total[:\s]*\$\s?([\d,]+)/i
    ];
    for (var i = 0; i < pats.length && !out.total; i++) {
      var t = text.match(pats[i]);
      if (t) { var v = digits(t[1]); if (v > 1000 && v < 250000) out.total = v; }
    }
    if (!out.total) {
      var all = (text.match(/\$\s?[\d,]+\.\d{2}/g) || []).map(digits).filter(function (n) { return n > 5000 && n < 250000; });
      if (all.length) out.total = Math.max.apply(null, all);
    }

    if (/class\s*4|impact[\s-]*resistant/i.test(text)) out.tier = 'ir';
    else if (/3[\s-]*tab|three[\s-]*tab/i.test(text)) out.tier = '3tab';
    else if (/architectural|laminated|dimensional|landmark|duration|timberline|heritage/i.test(text)) out.tier = 'arch';

    var st = text.match(/stor(?:y|ies)[:\s]*(\d)\b/i) || text.match(/\b(\d)[\s-]*stor(?:y|ies)/i);
    if (st) { var n = parseInt(st[1], 10); if (n >= 1 && n <= 4) out.stories = String(Math.min(3, n)); }
    var pt = text.match(/\b(\d{1,2}(?:\.\d)?)\s*\/\s*12\b/);
    if (pt) { var r = parseFloat(pt[1]); if (r >= 1 && r <= 24) out.pitchRise = r; }

    // What's included. Only mark what the text clearly says; everything else stays "Not sure".
    if (/\b(overlay|lay[\s-]?over|re-?cover)\b/.test(lower)) out.items.tearoff = 'no';
    else if (/tear[\s-]?off|remove (?:existing|old|all)|removal of existing/.test(lower)) out.items.tearoff = 'yes';
    if (/synthetic/.test(lower)) out.items.underlayment = 'yes';
    else if (/(?:install|new)[^.]{0,40}felt|(?:15|30)\s?(?:lb|#)\s*felt/.test(lower)) out.items.underlayment = 'no';
    if (/ice\s*(?:&|and)?\s*water/.test(lower)) out.items.valleys = 'yes';
    if (/(?:pipe|lead|vent)\s*(?:boot|jack|flashing)/.test(lower)) out.items.boots = 'yes';
    if (/shinglemaster|master elite|platinum preferred|certified (?:installer|contractor)|preferred contractor/.test(lower)) out.items.certified = 'yes';
    return out;
  }

  var pdfReady = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve();
    if (pdfReady) return pdfReady;
    pdfReady = new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = PDFJS + 'pdf.min.js';
      sc.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; resolve(); };
      sc.onerror = function () { pdfReady = null; reject(new Error('pdfjs')); };
      document.head.appendChild(sc);
    });
    return pdfReady;
  }
  async function pdfText(file) {
    await loadPdfJs();
    var pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    var text = '';
    for (var i = 1; i <= Math.min(pdf.numPages, 15); i++) {
      var page = await pdf.getPage(i);
      var content = await page.getTextContent();
      text += content.items.map(function (it) { return it.str; }).join(' ') + ' ';
    }
    return text.trim();
  }

  function setParseStatus(kind, html) {
    var el = $('parseStatus');
    if (!kind) { el.hidden = true; return; }
    el.className = 'parse-status is-' + kind;
    el.innerHTML = (kind === 'busy' ? '<span class="spin" aria-hidden="true"></span>' : '') + '<span>' + html + '</span>';
    el.hidden = false;
  }

  function applyParsed(p) {
    var found = [];
    if (p.squares) { $('upSq').value = sq1(p.squares); found.push(sq1(p.squares) + ' SQ'); }
    if (p.total) { $('upTotal').value = num(p.total); found.push(money(p.total)); }
    $('upSqTag').textContent = p.squares ? '✓ found' : '';
    $('upTotalTag').textContent = p.total ? '✓ found' : '';
    if (p.tier) { state.tier = p.tier; found.push(P.materials[p.tier].short); }
    if (p.stories) state.stories = p.stories;
    if (p.pitchRise) state.pitch = pitchKeyFromRise(p.pitchRise);
    Object.keys(P.competitorGaps).forEach(function (k) { state.items[k] = p.items[k] || 'unsure'; });
    state.quoteParsed = true;
    $('parsedBox').hidden = false;
    syncGroups();
    renderChecks();
    track('estimator_parsed', { squares: !!p.squares, total: !!p.total });
    if (p.squares && p.total) {
      setParseStatus('ok', 'Read it. Found ' + found.map(esc).join(' · ') + '. Check the details below.');
    } else {
      var what = !p.squares && !p.total ? 'the roof size or total' : !p.squares ? 'the roof size (squares)' : 'the total';
      setParseStatus('warn', "We couldn't find " + what + '. Type ' + (!p.squares && !p.total ? 'them' : 'it') + " below. It's usually near the top or bottom of the estimate.");
    }
  }

  async function handleFile(file) {
    $('upErr').textContent = '';
    if (!file) return;
    var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) {
      setParseStatus('warn', "Photos can't be read automatically yet. Type the roof size and total below, or text the photo to " +
        esc(P.contact.name) + ' at <a href="sms:' + esc(P.contact.phoneTel) + '">' + esc(P.contact.phoneDisplay) + '</a>.');
      $('parsedBox').hidden = false;
      return;
    }
    if (file.size > 15 * 1024 * 1024) { setParseStatus('warn', 'That file is over 15 MB. Try a smaller PDF, or paste the text.'); return; }
    setParseStatus('busy', 'Reading ' + esc(file.name) + '…');
    try {
      var text = await pdfText(file);
      if (text.replace(/\s/g, '').length < 40) {
        setParseStatus('warn', "That PDF looks like a scanned image, so we can't read the text. Type the roof size and total below.");
        $('parsedBox').hidden = false;
        return;
      }
      applyParsed(parseEstimateText(text));
    } catch (e) {
      setParseStatus('warn', "We couldn't open that PDF. Paste the text instead, or type the roof size and total below.");
      $('parsedBox').hidden = false;
    }
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

  function roofKnown() {
    return state.roofSource === 'satellite' || state.roofSource === 'manual' || (state.roofSource === 'quote' && !!state.quoteSquares);
  }

  function render(isBack, quiet) {
    var s = state.step;
    if (s === 'confirm') state.roofSource = 'satellite';
    if (s === 'manual') state.roofSource = 'manual';
    if (s === 'address') state.roofSource = null;

    qsa('.step').forEach(function (el) {
      var on = el.getAttribute('data-step') === s;
      el.hidden = !on;
      el.classList.toggle('is-back', !!(on && isBack));
      if (on) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
    });

    var idx = STEP_INDEX[s];
    var skipped = state.roofSource === 'quote' ? [2, 3] : [];
    qsa('#progress li').forEach(function (li, i) {
      li.classList.toggle('is-done', i < idx || (i === idx && s === 'results'));
      li.classList.toggle('is-current', i === idx && s !== 'results');
      li.style.opacity = skipped.indexOf(i) > -1 && s !== 'results' ? '0.35' : '';
    });

    $('wizFoot').hidden = FLOW_STEPS.indexOf(s) === -1;
    $('backBtn').style.visibility = state.history.length ? 'visible' : 'hidden';
    var lastBeforeResults = s === 'quote' || s === 'details' || (s === 'upload' && state.roofSource !== 'quote');
    $('nextBtn').textContent = lastBeforeResults ? 'See my estimate →' : 'Continue →';

    $('heroGrid').classList.toggle('is-wide', s === 'results');

    if (s === 'material') renderMaterials();
    if (s === 'quote' || s === 'upload') renderQuoteStep();
    if (s === 'results') renderResults();
    updateRunning();

    if (quiet) return;
    var card = $('estimator');
    var top = card.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    var heading = document.querySelector('.step[data-step="' + s + '"] .step-title, .step[data-step="' + s + '"] .res-range');
    if (heading && s !== 'address') {
      heading.setAttribute('tabindex', '-1');
      try { heading.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
    }
  }

  function updateRunning() {
    var show = ['confirm', 'manual', 'details', 'material', 'quote'].indexOf(state.step) > -1 && roofKnown();
    $('running').hidden = !show;
    if (!show) return;
    var e = estimate();
    $('runningVal').innerHTML = moneyK(e.low) + ' – ' + moneyK(e.high) + (P.pricesConfirmed ? '' : '<span class="draft-flag">DRAFT</span>');
    $('running').querySelector('small').textContent = 'Titan estimate · ' + P.materials[state.material].short;
  }

  function onStateChange(what) {
    if (what === 'hasQuote') {
      $('quoteBox').hidden = state.hasQuote !== 'yes';
      if (state.hasQuote === 'yes') setTimeout(function () { $('quoteAmt').focus(); }, 50);
    }
    if (what === 'tier' && state.roofSource === 'quote') state.material = state.tier;
    if (state.step === 'material') renderMaterials();
    updateRunning();
  }

  /* ───────────────────────── address / measuring ───────────────────────── */

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
      roof_not_found: "We found your address but couldn't get a clear satellite measurement of the roof. This happens with newer subdivisions. A few quick questions instead."
    }[reason] || "Satellite measuring isn't available right now. A few quick questions will get you the same estimate.";
    if (res && res.ok && !sane) msg = 'That roof measured outside the range we can estimate online (it may be a commercial or multi-unit building). A few quick questions instead.';
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
    if (m.quality && m.quality !== 'HIGH') notes.push('Satellite imagery here is lower resolution, so treat the roof size as approximate.');
    showNotice('confirmNotice', notes.map(esc).join('<br>'));
    $('confirmSub').textContent = m.imageryDate
      ? 'Check that the circle is on your home. Imagery from ' + monthName(m.imageryDate) + '.'
      : 'Check that the circle is on your home.';
  }
  function monthName(ym) {
    var p = ym.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  /* ───────────────────────── quote step ───────────────────────── */

  function renderQuoteStep() {
    renderChecks();
    syncGroups();
    $('quoteBox').hidden = state.hasQuote !== 'yes';
    if (state.quote) {
      $('quoteAmt').value = num(state.quote);
      if (!$('upTotal').value) $('upTotal').value = num(state.quote);
    }
    $('insurance').checked = state.insurance;
  }

  /* ───────────────────────── results ───────────────────────── */

  var ICON = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    scale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M5 21h14M4 8h16M7 8l-3 7a3 3 0 0 0 6 0zM17 8l-3 7a3 3 0 0 0 6 0z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
    info: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm.9 12.6H9.1v-1.8h1.8zm0-3.4H9.1V5.9h1.8z"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2z"/></svg>'
  };

  function verdict(est, q, gaps) {
    var missing = gaps.filter(function (g) { return g.status === 'no'; });
    var add = missing.reduce(function (s, g) { return s + g.cost; }, 0);
    var adj = q + add;
    var items = function (n) { return n + (n === 1 ? ' item' : ' items'); };
    var tierName = P.materials[state.material].short.toLowerCase();
    var v;
    if (q > est.high) {
      v = { cls: 'good', icon: ICON.check,
        title: 'You could save ' + money(q - est.high) + '–' + money(q - est.low),
        text: 'Their quote is above our full range for the same ' + tierName + ' roof, with a complete tear-off, synthetic underlayment, valley protection and new flashing included.' +
          (missing.length ? ' Their quote also leaves out ' + items(missing.length) + ' Titan includes.' : '') };
    } else if (q >= est.low) {
      v = { cls: 'even', icon: ICON.scale,
        title: 'Your quote is within our range',
        text: add > 0
          ? 'Similar money, different roof. Their quote leaves out ' + items(missing.length) + ' that Titan includes, worth about ' + money(add) + '.'
          : 'Similar money, so the difference is in the details: materials, installation and who stands behind the warranty.' };
    } else if (add > 0 && adj >= est.low) {
      v = { cls: 'under', icon: ICON.search,
        title: 'Lower price, less roof',
        text: 'Their quote is ' + money(est.low - q) + ' below our range, but it leaves out ' + items(missing.length) + ' Titan includes. Matched to the same scope, it comes to about ' + money(adj) + '.' };
    } else {
      v = { cls: 'under', icon: ICON.search,
        title: 'Their quote is ' + money(est.low - q) + ' below our range',
        text: "We'll be straight with you: if it's the same materials and the same install, that's a good price. Before you sign, check the items below, or text us a photo of the quote and we'll review it line by line, free." };
    }
    if (q < est.low * 0.45 || q > est.high * 2.5) {
      v.text += ' (That amount is far from typical for this roof size. Double-check that it covers a full replacement of the whole roof.)';
    }
    v.adj = add > 0 ? adj : null;
    v.add = add;
    v.missing = missing;
    return v;
  }

  function sourceLabel() {
    if (state.roofSource === 'satellite') return 'Satellite-measured';
    if (state.roofSource === 'quote') return 'Size from their estimate';
    return 'Estimated from home size';
  }

  function renderResults() {
    var est = estimate();
    var mat = P.materials[state.material];
    var f = factors();
    var sqft = roofSqft();
    var gaps = gapList(est.squares);
    var hasQ = !!state.quote;
    var v = hasQ ? verdict(est, state.quote, gaps) : null;
    var marketGap = r100((est.marketLow + est.marketHigh) / 2 - est.mid);

    track('estimator_result', {
      material: state.material, low: est.low, high: est.high, squares: Math.round(est.squares * 10) / 10,
      source: state.roofSource, has_quote: hasQ, verdict: v ? v.cls : 'none'
    });

    var pitchLabel = state.roofSource === 'satellite' && state.measure && state.measure.pitchRise != null
      ? Math.round(state.measure.pitchRise) + '/12 pitch'
      : P.pitch[state.pitch].label + ' pitch';

    var h = '';
    if (!P.pricesConfirmed) h += '<div class="draft-banner">Draft pricing: these numbers are pending Titan\'s sign-off.</div>';

    h += '<div class="res-top"><div>' +
      '<div class="eyebrow">Your Titan estimate · ' + esc(mat.short) + '</div>' +
      '<div class="res-range" aria-label="Estimate ' + money(est.low) + ' to ' + money(est.high) + '"><span data-count="' + est.low + '">' + money(est.low) + '</span><span class="dash">–</span><span data-count="' + est.high + '">' + money(est.high) + '</span></div>' +
      '<div class="res-mid">' + money(est.lowPerSq) + '–' + money(est.highPerSq) + ' per square, installed with a complete tear-off' +
        (marketGap > 0 ? ' · about <b>' + money(marketGap) + ' below</b> typical Houston pricing' : '') + '</div>' +
      '<div class="chips">' +
        '<span class="chip sat-chip">' + esc(sourceLabel()) + '</span>' +
        '<span class="chip">' + num(sqft) + ' sq ft · ' + sq1(est.squares) + ' SQ</span>' +
        '<span class="chip">' + esc(pitchLabel) + '</span>' +
        '<span class="chip">' + esc(P.complexity[state.complexity].label) + ' roof</span>' +
        '<span class="chip">' + (state.stories === '3' ? '3+ stories' : state.stories + (state.stories === '1' ? ' story' : ' stories')) + '</span>' +
      '</div></div>' +
      '<div class="res-actions">' +
        '<button type="button" class="btn btn-ghost" data-act="back">← Edit answers</button>' +
        '<button type="button" class="btn btn-ghost" data-act="print">Save or print</button>' +
        '<button type="button" class="btn btn-ghost" data-act="restart">Start over</button>' +
      '</div></div>';

    h += '<div class="cmp">';
    if (v) {
      h += '<div class="verdict ' + v.cls + '"><div class="verdict-ico">' + v.icon + '</div><div><h3>' + esc(v.title) + '</h3><p>' + esc(v.text) + '</p></div></div>';
    } else {
      h += '<div class="verdict ' + (marketGap > 0 ? 'good' : 'even') + '"><div class="verdict-ico">' + (marketGap > 0 ? ICON.check : ICON.shield) + '</div><div>' +
        '<h3>' + (marketGap > 0 ? 'About ' + money(marketGap) + ' below typical Houston pricing' : 'In line with typical Houston pricing') + '</h3>' +
        '<p>Typical Houston pricing for this roof runs ' + money(est.marketLow) + '–' + money(est.marketHigh) + '. Got another quote? Come back and add it, or text a photo to ' +
        esc(P.contact.name) + ' at ' + esc(P.contact.phoneDisplay) + " and we'll review it line by line, free.</p></div></div>";
    }
    h += '<div class="chart-wrap"><div class="chart-title">' + (v ? 'Their quote vs. Titan and typical Houston pricing' : 'Titan vs. typical Houston pricing for this roof') + '</div><div id="chart"></div></div>';
    h += '<div class="persq' + (v ? '' : ' two') + '">' +
      (v ? '<div><b>' + money(state.quote / (state.quoteSquares || est.squares)) + '</b><span>Their price per square' + (state.quoteSquares ? ' (' + sq1(state.quoteSquares) + ' SQ)' : '') + '</span></div>' : '') +
      '<div><b>' + money(est.lowPerSq) + '–' + money(est.highPerSq) + '</b><span>Titan per square</span></div>' +
      '<div><b>' + money(est.marketLowPerSq) + '–' + money(est.marketHighPerSq) + '</b><span>Houston typical per square</span></div>' +
      '</div>';
    h += specTable(gaps, !v) + '</div>';

    if (v && state.quoteSquares && state.roofSource !== 'quote') {
      var ratio = state.quoteSquares / est.squares;
      if (ratio > 1.22 || ratio < 0.88) {
        h += '<div class="sq-note">' + ICON.info + '<span><b>The roof sizes don\'t match.</b> Their estimate lists ' + sq1(state.quoteSquares) + ' SQ; we measured ' + sq1(est.squares) + ' SQ. ' +
          (ratio > 1 ? 'Quotes usually add 10–15% for waste, but a gap this big is worth asking about: you may be paying for roof you don\'t have.' : 'Their number is smaller than our measurement. Ask how they measured, so you\'re comparing the same roof.') + '</span></div>';
      }
    }

    if (state.insurance) {
      h += '<div class="ins-note">' + ICON.shield + '<span><b>Storm damage?</b> If your insurer approves a claim, you typically pay only your deductible and insurance covers the rest. We document the damage and meet your adjuster on site. <a href="/storm-damage.html">How storm claims work →</a></span></div>';
    }

    var rows = [
      ['Roof size', num(sqft) + ' sq ft (' + sq1(est.squares) + ' SQ)'],
      [mat.short + ' base', money(mat.low) + '–' + money(mat.high) + ' / SQ'],
      ['Stories', f.stories === 1 ? 'No adjustment' : pct(f.stories)],
      ['Roof shape', f.complexity === 1 ? 'No adjustment' : pct(f.complexity)],
      ['Pitch', f.pitch === 1 ? 'No adjustment' : pct(f.pitch)],
      ['Your price per square', money(est.lowPerSq) + '–' + money(est.highPerSq)],
      ['Your estimate', money(est.low) + ' – ' + money(est.high)]
    ];
    h += '<div class="res-grid">' +
      '<div class="res-card"><h4>How we got this number</h4>' + rows.map(function (r) {
        return '<div class="math-row"><span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span></div>';
      }).join('') + '</div>' +
      '<div class="res-card"><h4>Included in every Titan roof</h4><ul class="ticks">' +
        P.scope.map(function (s) { return '<li><span>' + esc(s[0]) + (s[1] !== 'Included' ? ' <span class="row-note" style="display:inline">(' + esc(s[1]) + ')</span>' : '') + '</span></li>'; }).join('') +
      '</ul></div>' +
      '<div class="res-card"><h4>What could change the final price</h4><ul class="ticks plus">' +
        P.adjustments.map(function (a) { return '<li><span>' + esc(a) + '</span></li>'; }).join('') +
      '</ul></div>' +
    '</div>';

    h += leadBlock(est);

    h += '<p class="res-fine">This is a pre-inspection estimate, not a bid or a contract. It assumes one existing layer of shingles. Your fixed price is set after a free on-site inspection, and any change is confirmed with you in writing before work starts. ' +
      'Typical Houston pricing is based on published market research, not a quote from any contractor. "Matched to the same scope" figures are typical costs for the missing items. ' +
      (state.quote ? 'Competitor figures are shown as you provided them. ' : '') + 'Pricing reviewed ' + esc(P.lastReviewed) + '.</p>';

    $('results').innerHTML = h;
    drawChart(est, state.quote, v ? v.adj : null);
    bindResults(est);
    countUp();
  }

  function specTable(gaps, titanOnly) {
    var head = titanOnly
      ? '<caption>Questions to ask every roofer</caption><thead><tr><th scope="col">Item</th><th scope="col">Ask them</th><th scope="col">Titan</th></tr></thead>'
      : '<caption>What\'s in each quote</caption><thead><tr><th scope="col">Item</th><th scope="col">Their quote</th><th scope="col">Titan</th></tr></thead>';
    var body = gaps.map(function (x) {
      var cell;
      if (titanOnly) cell = '<span class="row-note">' + esc(x.g.ask) + '</span>';
      else if (x.status === 'yes') cell = '<span class="tag y">✓ Included</span>';
      else if (x.status === 'no') cell = '<span class="tag n">✗ Not included' + (x.cost > 0 ? ' · +' + money(x.cost) + ' to match' : '') + '</span><span class="row-note">' + esc(x.g.ifMissing) + '</span>';
      else cell = '<span class="tag u">? Ask them</span><span class="row-note">' + esc(x.g.ask) + '</span>';
      return '<tr><th scope="row">' + esc(x.g.label) + '</th><td>' + cell + '</td><td class="titan">✓ Included</td></tr>';
    }).join('');
    return '<table class="spec-table">' + head + '<tbody>' + body + '</tbody></table>';
  }

  function leadBlock(est) {
    var c = P.contact;
    if (state.leadSent) {
      return '<div class="lead" id="lead"><div class="lead-pitch"><h3>You\'re all set</h3><p>We have your estimate and details.</p></div><div class="lead-form">' + leadSuccess() + '</div></div>';
    }
    return '<div class="lead" id="lead">' +
      '<div class="lead-pitch">' +
        '<h3>Want this in writing? <em>Lock in your price.</em></h3>' +
        '<p>A free roof inspection turns this range into a fixed price. No salesman in your living room, no 90-minute pitch.</p>' +
        '<ol><li>' + esc(c.name) + ' reaches out to set a time that suits you</li><li>We inspect the roof and confirm measurements and decking</li><li>You get a fixed written price. No pressure, no obligation</li></ol>' +
        '<div class="lead-alt">' +
          '<a href="tel:' + esc(c.phoneTel) + '">' + ICON.phone + 'Call ' + esc(c.phoneDisplay) + '</a>' +
          '<a href="sms:' + esc(c.phoneTel) + '">' + ICON.chat + 'Text a photo of your quote</a>' +
        '</div>' +
      '</div>' +
      '<form class="lead-form" id="leadForm" novalidate>' +
        '<div class="row2">' +
          '<div class="fld"><label for="leadFirst">First name</label><input id="leadFirst" autocomplete="given-name" required></div>' +
          '<div class="fld"><label for="leadLast">Last name <small>(optional)</small></label><input id="leadLast" autocomplete="family-name"></div>' +
        '</div>' +
        '<div class="row2">' +
          '<div class="fld"><label for="leadEmail">Email</label><input id="leadEmail" type="email" autocomplete="email" required placeholder="you@example.com"></div>' +
          '<div class="fld"><label for="leadPhone">Phone <small>(optional)</small></label><input id="leadPhone" type="tel" autocomplete="tel" inputmode="tel" placeholder="(281) 555-1234"></div>' +
        '</div>' +
        '<div class="fld"><label for="leadAddr">Property address</label><input id="leadAddr" autocomplete="street-address" placeholder="Street, city" value="' + esc(state.address) + '"></div>' +
        '<div class="fld"><label for="leadMsg">Anything else? <small>(optional)</small></label><input id="leadMsg" placeholder="Timing, concerns, best time to call"></div>' +
        '<input class="hp" id="leadHp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
        '<p class="field-error" id="leadErr" role="alert"></p>' +
        '<button type="submit" class="btn btn-primary btn-block" id="leadBtn">Lock in my price →</button>' +
        '<p class="lead-fine">We\'ll only contact you to schedule the free inspection. Your estimate (' + money(est.low) + '–' + money(est.high) + ') is sent with it.</p>' +
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
    var first = $('leadFirst').value.trim();
    var email = $('leadEmail').value.trim();
    var err = $('leadErr');
    qsa('#leadForm input').forEach(function (i) { i.removeAttribute('aria-invalid'); });
    if (!first) { err.textContent = 'Please add your first name.'; $('leadFirst').setAttribute('aria-invalid', 'true'); $('leadFirst').focus(); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = 'Please add a valid email so we can send your fixed price.'; $('leadEmail').setAttribute('aria-invalid', 'true'); $('leadEmail').focus(); return; }
    err.textContent = '';
    if ($('leadHp').value) { leadDone(); return; } // a bot filled the hidden field

    var btn = $('leadBtn');
    btn.disabled = true; btn.textContent = 'Sending…';
    var gaps = gapList(est.squares);
    var listOf = function (st) { return gaps.filter(function (g) { return g.status === st; }).map(function (g) { return g.g.label; }).join(', ') || '—'; };
    var m = state.measure;
    // Field names match the site's existing FormSubmit forms and the prototype.
    var payload = {
      _subject: 'Instant Estimate Lead — Titan Roofing',
      _template: 'table',
      _captcha: 'false',
      'Source': 'Instant Estimate Tool',
      'First Name': first,
      'Last Name': $('leadLast').value.trim(),
      'Email': email,
      'Phone': $('leadPhone').value.trim(),
      'Property Address': $('leadAddr').value.trim(),
      'Message': $('leadMsg').value.trim(),
      'Estimated Price Range': money(est.low) + ' - ' + money(est.high),
      'Roof Size': sq1(est.squares) + ' SQ (' + num(roofSqft()) + ' sq ft), ' + sourceLabel().toLowerCase() +
        (state.roofSource === 'satellite' && m ? ', ' + m.quality + ' imagery, ' + m.segments + ' planes' : '') +
        (state.roofSource === 'manual' ? ', ' + num(state.homeSqft) + ' sq ft home, garage ' + state.garage : ''),
      'Stories': state.stories === '3' ? '3+' : state.stories,
      'Complexity': P.complexity[state.complexity].label,
      'Pitch': state.roofSource === 'satellite' && m && m.pitchRise != null ? Math.round(m.pitchRise) + '/12 (measured)' : P.pitch[state.pitch].label,
      'Shingle Tier': P.materials[state.material].name,
      'Competitor Estimate Total': state.quote ? money(state.quote) + (state.quoteSquares ? ' for ' + sq1(state.quoteSquares) + ' SQ' : '') + (state.quoteParsed ? ' (read from upload)' : ' (typed)') : '—',
      'Competitor Missing': state.quote ? listOf('no') : '—',
      'Homeowner Unsure About': state.quote ? listOf('unsure') : '—',
      'Storm / Insurance': state.insurance ? 'Yes' : 'No',
      'Pricing Status': P.pricesConfirmed ? 'Confirmed' : 'DRAFT pricing'
    };
    try {
      var r = await fetch('https://formsubmit.co/ajax/' + encodeURIComponent(P.contact.email), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok || String(data.success) !== 'true') throw new Error('send failed');
      track('estimator_lead', { material: state.material, low: est.low, high: est.high, has_quote: !!state.quote });
      leadDone();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Lock in my price →';
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
        el.textContent = money(r50(start + (target - start) * e));
        if (p < 1) requestAnimationFrame(frame); else el.textContent = money(target);
      }
      requestAnimationFrame(frame);
    });
  }

  /* ───────────────────────── chart ─────────────────────────
     Two range bands (Houston typical, Titan) on one dollar axis,
     plus their quote and the scope-matched quote as markers. */

  var lastChart = null;
  function drawChart(est, q, adj) {
    lastChart = { est: est, q: q, adj: adj };
    var host = $('chart');
    if (!host) return;
    var W = Math.max(280, host.clientWidth), small = W < 460, fs = small ? 12 : 13;
    var vals = [est.low, est.high, est.marketLow, est.marketHigh].concat(q ? [q] : []).concat(adj ? [adj] : []);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = Math.max((hi - lo) * 0.12, hi * 0.04);
    var d0 = Math.max(0, lo - pad), d1 = hi + pad, L = 8, R = 8;
    var x = function (v) { return L + (v - d0) / (d1 - d0) * (W - L - R); };
    var halo = ' paint-order="stroke" stroke="#fff" stroke-width="5" stroke-linejoin="round"';
    function anchor(px, textW) {
      if (px - textW / 2 < 2) return { a: 'start', x: Math.max(2, px - 8) };
      if (px + textW / 2 > W - 2) return { a: 'end', x: Math.min(W - 2, px + 8) };
      return { a: 'middle', x: px };
    }
    function bandLabel(x0, x1, text) {
      var tw = text.length * fs * 0.55;
      if (x0 + tw <= W - 2) return { a: 'start', x: x0 };
      return { a: 'end', x: Math.min(W - 2, x1) };
    }

    var top = q ? 34 : 6;
    var mY = top + 16, mH = 12;          // Houston typical band
    var tY = mY + mH + 30, tH = 18;      // Titan band
    var aY = tY + tH + 22;               // matched-scope marker
    var axisY = adj ? aY + 36 : tY + tH + 14, H = axisY + 22;

    var span = d1 - d0, steps = [500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000], step = steps[steps.length - 1];
    for (var i = 0; i < steps.length; i++) { if (span / steps[i] <= (small ? 4 : 6)) { step = steps[i]; break; } }
    var svg = '<svg class="rchart" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc('Titan ' + money(est.low) + ' to ' + money(est.high) + '. Houston typical ' + money(est.marketLow) + ' to ' + money(est.marketHigh) + '.' +
        (q ? ' Their quote ' + money(q) + '.' : '') + (adj ? ' Their quote matched to the same scope about ' + money(adj) + '.' : '')) + '">';
    svg += '<defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8z" fill="#B42318"/></marker></defs>';
    for (var t = Math.ceil(d0 / step) * step; t <= d1; t += step) {
      svg += '<line x1="' + x(t) + '" x2="' + x(t) + '" y1="' + (mY - 4) + '" y2="' + axisY + '" stroke="#EEF0F3"/>' +
        '<text x="' + x(t) + '" y="' + (axisY + 16) + '" text-anchor="middle" font-size="' + (fs - 1) + '" fill="#6B7280">' + moneyK(t) + '</text>';
    }
    svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + axisY + '" y2="' + axisY + '" stroke="#D1D5DB"/>';

    var mx0 = x(est.marketLow), mx1 = x(est.marketHigh);
    var mText = 'Houston typical ' + moneyK(est.marketLow) + '–' + moneyK(est.marketHigh);
    var mA = bandLabel(mx0, mx1, mText);
    svg += '<text x="' + mA.x + '" y="' + (mY - 5) + '" text-anchor="' + mA.a + '" font-size="' + (fs - 0.5) + '" font-weight="600" fill="#4B5563"' + halo + '>' + esc(mText) + '</text>' +
      '<rect x="' + mx0 + '" y="' + mY + '" width="' + Math.max(4, mx1 - mx0) + '" height="' + mH + '" rx="4" fill="#B9C2CF"/>';
    var tx0 = x(est.low), tx1 = x(est.high);
    var tText = 'Titan ' + moneyK(est.low) + '–' + moneyK(est.high);
    var tA = bandLabel(tx0, tx1, tText);
    svg += '<text x="' + tA.x + '" y="' + (tY - 6) + '" text-anchor="' + tA.a + '" font-size="' + fs + '" font-weight="700" fill="#1B2A4A"' + halo + '>' + esc(tText) + '</text>' +
      '<rect x="' + tx0 + '" y="' + tY + '" width="' + Math.max(4, tx1 - tx0) + '" height="' + tH + '" rx="4" fill="#1B2A4A"/>' +
      '<line x1="' + x(est.mid) + '" x2="' + x(est.mid) + '" y1="' + (tY + 4) + '" y2="' + (tY + tH - 4) + '" stroke="#D4A853" stroke-width="2.5" stroke-linecap="round"/>';

    if (q) {
      var qx = x(q), qText = 'Their quote ' + money(q), qA = anchor(qx, qText.length * fs * 0.56);
      svg += '<line x1="' + qx + '" x2="' + qx + '" y1="' + (top - 6) + '" y2="' + (tY + tH + 6) + '" stroke="#111827" stroke-width="2"/>' +
        '<path d="M' + qx + ' ' + (top - 13) + ' l7 7 -7 7 -7 -7z" fill="#111827" stroke="#fff" stroke-width="2"/>' +
        '<text x="' + qA.x + '" y="' + (top - 18) + '" text-anchor="' + qA.a + '" font-size="' + fs + '" font-weight="700" fill="#111827"' + halo + '>' + esc(qText) + '</text>';
      if (adj) {
        var ax = x(adj), aText = 'Matched to same scope ≈ ' + money(adj), aA = anchor(ax, aText.length * fs * 0.52);
        svg += '<line x1="' + ax + '" x2="' + ax + '" y1="' + (tY - 2) + '" y2="' + (aY - 8) + '" stroke="#6B7280" stroke-width="1.5" stroke-dasharray="3 3"/>' +
          '<path d="M' + ax + ' ' + (aY - 7) + ' l7 7 -7 7 -7 -7z" fill="#fff" stroke="#374151" stroke-width="2"/>' +
          '<text x="' + aA.x + '" y="' + (aY + 22) + '" text-anchor="' + aA.a + '" font-size="' + (fs - 0.5) + '" font-weight="600" fill="#374151"' + halo + '>' + esc(aText) + '</text>';
        if (Math.abs(ax - qx) > 12) svg += '<path d="M' + qx + ' ' + aY + ' H' + (ax - 9) + '" stroke="#B42318" stroke-width="1.5" marker-end="url(#arr)" opacity="0.7"/>';
      }
    }

    svg += hit(mx0, mY - 4, mx1 - mx0, mH + 8, '<b>Typical Houston pricing</b>' + money(est.marketLow) + ' – ' + money(est.marketHigh) + '<br>' + money(est.marketLowPerSq) + '–' + money(est.marketHighPerSq) + ' per square');
    svg += hit(tx0, tY - 4, tx1 - tx0, tH + 8, '<b>Titan estimate</b>' + money(est.low) + ' – ' + money(est.high) + '<br>' + money(est.lowPerSq) + '–' + money(est.highPerSq) + ' per square');
    if (q) svg += hit(x(q) - 14, top - 20, 28, tY + tH - top + 26, '<b>Their quote</b>' + money(q) + '<br>' + money(q / (state.quoteSquares || est.squares)) + ' per square');
    if (adj) svg += hit(x(adj) - 14, aY - 14, 28, 28, '<b>Matched to the same scope</b>≈ ' + money(adj) + '<br>Their quote + typical cost of the missing items');
    svg += '</svg>';
    host.innerHTML = svg;
    bindTips(host);
  }
  function hit(x0, y0, w, h, html) {
    return '<rect class="hit" x="' + x0 + '" y="' + y0 + '" width="' + Math.max(16, w) + '" height="' + h + '" fill="transparent" data-tip="' + esc(html) + '"/>';
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
      ['pointerenter', 'pointermove', 'pointerdown'].forEach(function (ev) { el.addEventListener(ev, function (e) { show(e, el); }); });
      el.addEventListener('pointerleave', function () { tip.classList.remove('is-on'); });
    });
  }
  var resizeT;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { if (state.step === 'results' && lastChart) drawChart(lastChart.est, lastChart.q, lastChart.adj); }, 120);
  });
  document.addEventListener('scroll', function () { $('tip').classList.remove('is-on'); }, { passive: true });

  /* ───────────────────────── wiring ───────────────────────── */

  function restart() {
    state.history = [];
    state.measure = null;
    state.roofSource = null;
    state.hasQuote = null;
    state.quote = null;
    state.quoteSquares = null;
    state.quoteParsed = false;
    state.leadSent = false;
    state.material = P.defaultMaterial;
    state.tier = P.defaultMaterial;
    Object.keys(state.items).forEach(function (k) { state.items[k] = 'unsure'; });
    ['quoteAmt', 'addr', 'upSq', 'upTotal', 'pasteText'].forEach(function (id) { $(id).value = ''; });
    $('upSqTag').textContent = ''; $('upTotalTag').textContent = '';
    $('parsedBox').hidden = true;
    setParseStatus(null);
    showNotice('manualNotice', '');
    state.step = 'address';
    render(true);
  }

  function readUpload() {
    var sq = digits($('upSq').value), total = digits($('upTotal').value);
    $('parsedBox').hidden = false;
    if (!(sq >= 8 && sq <= 200)) {
      $('upErr').textContent = 'Enter the roof size in squares (SQ) from their estimate, for example 28.5.';
      $('upSq').focus();
      return false;
    }
    if (!(total >= 2000 && total <= 250000)) {
      $('upErr').textContent = 'Enter their total price for the whole roof, for example 19,750.';
      $('upTotal').focus();
      return false;
    }
    $('upErr').textContent = '';
    state.quoteSquares = sq;
    state.quote = Math.round(total);
    state.hasQuote = 'yes';
    if (state.roofSource === 'quote') state.material = state.tier;
    return true;
  }

  function next() {
    var s = state.step;
    if (s === 'confirm' || s === 'manual') {
      if (s === 'manual') track('estimator_start', { method: 'manual' });
      return go('material');
    }
    if (s === 'material') return go('quote');
    if (s === 'upload') {
      if (!readUpload()) return;
      track('estimator_start', { method: 'upload' });
      return go(state.roofSource === 'quote' ? 'details' : 'results');
    }
    if (s === 'details') return go('results');
    if (s === 'quote') {
      state.insurance = $('insurance').checked;
      if (state.hasQuote === 'yes') {
        var raw = $('quoteAmt').value, q = digits(raw);
        if (/k\s*$/i.test(raw.trim()) && q < 1000) q *= 1000;
        if (!(q >= 2000 && q <= 250000)) {
          $('quoteErr').textContent = 'Enter their total price for the whole roof, for example 16,500.';
          $('quoteAmt').setAttribute('aria-invalid', 'true');
          $('quoteAmt').focus();
          return;
        }
        if (q !== state.quote) { state.quoteSquares = null; state.quoteParsed = false; }
        state.quote = Math.round(q);
      } else {
        state.quote = null;
        state.quoteSquares = null;
      }
      $('quoteErr').textContent = '';
      return go('results');
    }
  }

  function init() {
    renderGroups();
    renderChecks();

    $('addrForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('addr').value.trim();
      $('addr').removeAttribute('aria-invalid');
      $('addrErr').textContent = '';
      if (!state.satelliteAvailable) {
        // No satellite measuring: keep the address for the lead form, ask about the home instead.
        state.address = v;
        showNotice('manualNotice', '');
        return go('manual');
      }
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
        var target = b.getAttribute('data-go');
        showNotice('manualNotice', '');
        if (target === 'upload') {
          if (state.step === 'address') state.roofSource = 'quote';
          state.hasQuote = 'yes';
        }
        go(target);
      });
    });

    $('nextBtn').addEventListener('click', next);
    $('backBtn').addEventListener('click', back);

    // Home size slider + number box
    var range = $('homeSize'), box = $('homeSizeNum');
    function setSize(v, from) {
      v = Math.max(600, Math.min(9000, Math.round(v)));
      state.homeSqft = v;
      if (from !== 'range') range.value = Math.max(Number(range.min), Math.min(Number(range.max), v));
      if (from !== 'box') box.value = num(v);
      range.style.setProperty('--fill', ((Number(range.value) - Number(range.min)) / (Number(range.max) - Number(range.min)) * 100) + '%');
      updateRunning();
    }
    range.addEventListener('input', function () { setSize(Number(range.value), 'range'); });
    box.addEventListener('input', function () { var v = digits(box.value); if (v >= 600) setSize(v, 'box'); });
    box.addEventListener('blur', function () { setSize(digits(box.value) || state.homeSqft); });
    setSize(state.homeSqft);

    // Money inputs: format as typed
    ['quoteAmt', 'upTotal'].forEach(function (id) {
      $(id).addEventListener('input', function (e) {
        var el = e.target, raw = el.value;
        if (/k/i.test(raw)) return;
        var d = raw.replace(/[^0-9]/g, '').slice(0, 7);
        el.value = d ? Number(d).toLocaleString('en-US') : '';
        el.removeAttribute('aria-invalid');
        $('quoteErr').textContent = ''; $('upErr').textContent = '';
        if (id === 'upTotal') $('upTotalTag').textContent = '';
      });
    });
    $('upSq').addEventListener('input', function () { $('upSqTag').textContent = ''; $('upErr').textContent = ''; });
    $('quoteAmt').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); next(); } });
    $('insurance').addEventListener('change', function (e) { state.insurance = e.target.checked; });

    // Upload: file picker, drag and drop, paste, or type the numbers
    $('fileIn').addEventListener('change', function (e) { handleFile(e.target.files[0]); e.target.value = ''; });
    var drop = $('drop');
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); }); });
    drop.addEventListener('drop', function (e) { handleFile(e.dataTransfer.files[0]); });
    $('pasteBtn').addEventListener('click', function () {
      var t = $('pasteText').value;
      if (t.trim().length < 20) { setParseStatus('warn', 'Paste a bit more of the estimate, including the roof size and total.'); return; }
      applyParsed(parseEstimateText(t));
    });
    $('typeOwn').addEventListener('click', function () { $('parsedBox').hidden = false; $('upSq').focus(); });

    render(false, true);

    fetch(API + '?probe=1', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (!d || !d.configured) disableSatellite(); })
      .catch(disableSatellite);
  }

  function disableSatellite() {
    state.satelliteAvailable = false;
    // The first screen keeps the upload option; the address box leads to the home-size questions.
    $('t-address').textContent = "Let's size your roof";
    document.querySelector('[data-step="address"] .step-sub').textContent = "Enter your address and we'll ask a few quick questions about your home. Or upload a quote you already have.";
    document.querySelector('#addrForm button[type=submit]').textContent = 'Continue →';
    var mi = document.querySelector('[data-step="address"] .micro');
    if (mi) mi.lastChild.textContent = ' Your address is only used for your estimate. Nobody contacts you unless you ask us to.';
  }

  // Exposed for automated tests.
  window.__titanEstimator = { parse: parseEstimateText };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

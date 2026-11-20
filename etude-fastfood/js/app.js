/* Carte et tableau de bord fast-food
   Données : data/zones.geojson, produit par scripts/preparer_donnees.py depuis la sortie FME. */
(function () {
  'use strict';

  // ---------- Constantes ----------
  var COLORS = ['#E3E2DD', '#FED976', '#FD8D3C', '#E31A1C', '#800026'];
  var CLS = ['Peu favorable', 'Moyen', 'Favorable', 'Très favorable', 'Prioritaire'];
  var RANGES = ['50 à 100 %', '20 à 50 %', '5 à 20 %', '1 à 5 %', '1 % le mieux classé'];
  var VERDICT = [
    'Dans la moitié la moins bien classée.',
    'Entre 20 et 50 % des zones les mieux classées.',
    'Entre 5 et 20 % des zones les mieux classées.',
    'Entre 1 et 5 % des zones les mieux classées.',
    'Dans le 1 % des zones les mieux classées.'
  ];
  var KEYS = ['acc', 'pa', 'dens', 'conc'];
  var NAMES = { acc: 'Accès routier', pa: 'Pouvoir d’achat', dens: 'Population', conc: 'Concurrence' };
  var MEAS = { acc: 'distance à la route principale', pa: 'niveau de vie moyen des habitants', dens: 'habitants au km²', conc: 'fast-foods déjà installés à moins de 2 km' };
  var LV = {
    acc: ['Isolée', 'Peu accessible', 'Accessible', 'Très accessible'],
    pa: ['Modeste', 'Intermédiaire', 'Aisé'],
    dens: ['Peu dense', 'Intermédiaire', 'Dense'],
    conc: ['Concurrence forte', 'Concurrence modérée', 'Concurrence faible', 'Aucune concurrence']
  };
  // Libellés courts, quand le mot « Concurrence » est déjà écrit à côté (boutons des alternatives)
  var LV_SHORT = { conc: ['forte', 'modérée', 'faible', 'aucune'] };
  function lvShort(k, l) { return LV_SHORT[k] ? LV_SHORT[k][l] : LV[k][l].toLowerCase(); }
  var REFW = { acc: 35, pa: 30, dens: 20, conc: 15 };
  var PROF = {
    acc: [['Peu importe', 0], ['Accessible ou mieux', 2], ['Très accessible', 3]],
    pa: [['Peu importe', 0], ['Intermédiaire ou mieux', 1], ['Aisé', 2]],
    dens: [['Peu importe', 0], ['Intermédiaire ou plus', 1], ['Dense', 2]],
    conc: [['Peu importe', 0], ['Faible ou aucune', 2], ['Aucune', 3]]
  };
  var STRONG = { acc: 'très accessible', pa: 'pouvoir d’achat élevé', dens: 'population dense', conc: 'sans concurrent proche' };
  var DEPTS = { '22': 'Côtes-d’Armor', '29': 'Finistère', '35': 'Ille-et-Vilaine', '44': 'Loire-Atlantique', '49': 'Maine-et-Loire', '53': 'Mayenne', '56': 'Morbihan', '72': 'Sarthe', '85': 'Vendée' };
  var DEPT_ORDER = ['22', '29', '35', '44', '49', '53', '56', '72', '85'];
  var ALT_RADIUS = 5000; // mètres
  function wmtsIGN(layer, format) {
    return 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=' + layer + '&STYLE=normal&TILEMATRIXSET=PM&FORMAT=' + format + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';
  }
  var IGN_TILES = wmtsIGN('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png');
  var ORTHO_TILES = wmtsIGN('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg');
  var FONDS = ['ign', 'ortho'];
  var FOND_NOMS = { ign: 'Plan IGN', ortho: 'photographies aériennes IGN' };
  var fondActif = 'ign';
  var SHEETJS = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';

  // ---------- État ----------
  var state = {
    mode: 'ref',
    imp: { acc: 35, pa: 30, dens: 20, conc: 15 },
    dept: 'all',
    prof: { acc: 0, pa: 0, dens: 0, conc: 0 },
    hidden: {},
    onePer: true,
    sel: null,
    alt: null,
    full: false
  };
  var Z = [];        // zones
  var META = null;
  var CUTS = [];     // rang maximal des classes 4, 3, 2, 1
  var N = 0;
  var MED = 24409;
  var map = null, mapReady = false, hoverId = null, popup = null;
  var byCommune = {}; // nom normalisé vers liste d'index
  var deptBox = {};
  var simValid = true;

  // ---------- Outils ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return Math.round(n).toLocaleString('fr-FR'); }
  function fr1(n) { return n.toFixed(1).replace('.', ','); }
  function norm(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').replace(/[-\s]+/g, ' ').trim(); }
  function plural(n, one, many) { return n > 1 ? many : one; }
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3600);
  }
  function classOfRank(r) { return r <= CUTS[0] ? 4 : r <= CUTS[1] ? 3 : r <= CUTS[2] ? 2 : r <= CUTS[3] ? 1 : 0; }
  function isSim() { return state.mode === 'sim' && simValid; }
  function rankOf(z) { return isSim() ? z.sr : z.r; }
  function clsOf(z) { return isSim() ? z.sk : z.k; }
  function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }

  // ---------- Niveaux des critères ----------
  function levels(z) {
    return {
      acc: z.dr < 500 ? 3 : z.dr < 1500 ? 2 : z.dr < 3000 ? 1 : 0,
      pa: z.nv === null ? 1 : z.nv > MED * 1.2 ? 2 : z.nv >= MED * 0.8 ? 1 : 0,
      dens: z.de > 1500 ? 2 : z.de >= 300 ? 1 : 0,
      conc: z.nc === 0 ? 3 : z.nc <= 5 ? 2 : z.nc <= 20 ? 1 : 0
    };
  }
  function valueText(z, k) {
    if (k === 'acc') return z.dr < 50 ? 'route principale à moins de 50 m' : z.dr < 1000 ? 'route principale à ' + fmt(z.dr) + ' m' : 'route principale à ' + fr1(z.dr / 1000) + ' km';
    if (k === 'pa') return z.nv === null ? 'donnée non diffusée par l’Insee (valeur médiane utilisée)' : fmt(z.nv) + ' € par an et par habitant';
    if (k === 'dens') return fmt(z.po) + ' ' + plural(Math.round(z.po), 'habitant', 'habitants') + ' dans la zone (' + fmt(z.de) + ' au km²)';
    return z.nc === 0 ? 'aucun fast-food à moins de 2 km' : z.nc + ' ' + plural(z.nc, 'fast-food', 'fast-foods') + ' à moins de 2 km';
  }
  function quality(z, k) { var n = LV[k].length, l = z.lv[k]; return l === n - 1 ? 'good' : l === 0 ? 'weak' : 'mid'; }
  function why(z) {
    var s = [];
    KEYS.forEach(function (k) { if (z.lv[k] === LV[k].length - 1 && !(k === 'pa' && z.nv === null)) s.push(STRONG[k]); });
    if (z.lv.conc === 2) s.push('peu de concurrence');
    if (!s.length) return 'Profil équilibré';
    var t = s.slice(0, 2).join(', ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // ---------- Calcul de la simulation ----------
  function computeSim() {
    var w = state.imp, sum = w.acc + w.pa + w.dens + w.conc;
    simValid = sum > 0;
    if (!simValid) return;
    var i;
    for (i = 0; i < N; i++) {
      var z = Z[i];
      z.ss = (z.a * w.acc + z.p * w.pa + z.d * w.dens + (1 - z.h) * w.conc) / sum;
    }
    var order = new Array(N);
    for (i = 0; i < N; i++) order[i] = i;
    order.sort(function (a, b) { return (Z[b].ss - Z[a].ss) || (Z[a].r - Z[b].r); });
    for (i = 0; i < N; i++) { var zz = Z[order[i]]; zz.sr = i + 1; zz.sk = classOfRank(i + 1); }
  }

  function visibleOf(z) {
    if (state.hidden[clsOf(z)]) return false;
    if (state.dept !== 'all' && z.dp !== state.dept) return false;
    for (var j = 0; j < 4; j++) { var k = KEYS[j]; if (z.lv[k] < PROF[k][state.prof[k]][1]) return false; }
    return true;
  }

  // Met à jour la carte (états des entités) puis l'interface.
  function apply() {
    for (var i = 0; i < N; i++) {
      var z = Z[i];
      var k = clsOf(z), v = visibleOf(z);
      if (mapReady && (z._k !== k || z._v !== v)) {
        map.setFeatureState({ source: 'zones', id: z.id }, { k: k, v: v });
      }
      z._k = k; z._v = v;
    }
    renderAll();
  }

  // ---------- Rendu de l'interface ----------
  function renderMode() {
    var sim = state.mode === 'sim';
    $('btn-ref').setAttribute('aria-pressed', String(!sim));
    $('btn-sim').setAttribute('aria-pressed', String(sim));
    $('mode-hint-ref').hidden = sim;
    $('mode-hint-sim').hidden = !sim;
    $('sim-banner').hidden = !sim;
    $('weights-ref').hidden = sim;
    $('weights-sim').hidden = !sim;
    $('warn-zero').hidden = !(sim && !simValid);
    $('top-title').textContent = isSim() ? 'Meilleures zones selon vos priorités' : 'Meilleures zones de l’analyse de référence';
  }

  function renderSliderLabels() {
    var w = state.imp, sum = w.acc + w.pa + w.dens + w.conc;
    KEYS.forEach(function (k) {
      $('val-' + k).textContent = w[k];
      $('pct-' + k).textContent = sum ? Math.round(w[k] / sum * 100) : 0;
      $('imp-' + k).value = w[k];
    });
  }

  function visibleList() {
    var out = [];
    for (var i = 0; i < N; i++) if (Z[i]._v) out.push(Z[i]);
    out.sort(function (a, b) { return rankOf(a) - rankOf(b); });
    return out;
  }

  function renderTop(vis) {
    var list = vis;
    if (state.onePer) {
      var seen = {};
      list = vis.filter(function (z) { if (seen[z.ic]) return false; seen[z.ic] = true; return true; });
    }
    // Nombre de cartes : au moins 8, arrondi pour remplir des rangées complètes
    var gridW = $('top-list').clientWidth || 700;
    var cols = Math.max(1, Math.floor((gridW + 10) / 240));
    var top = list.slice(0, cols * Math.ceil(8 / cols));
    $('top-empty').hidden = top.length > 0;
    $('top-list').innerHTML = top.map(function (z) {
      var k = clsOf(z);
      return '<button type="button" class="top-item' + (state.sel === z.id ? ' is-sel' : '') + '" data-id="' + z.id + '">' +
        '<span class="top-rang">' + fmt(rankOf(z)) + '</span>' +
        '<span class="top-text"><span class="top-commune">' + esc(z.c) + '</span>' +
        '<span class="top-cls"><span class="sw sw-xs" style="background:' + COLORS[k] + '"></span>' + CLS[k] + '</span>' +
        '<span class="top-why">' + esc(why(z)) + '</span></span></button>';
    }).join('');
  }

  function critHtml(z) {
    return KEYS.map(function (k) {
      return '<div class="crit"><div class="crit-text"><span class="crit-name">' + NAMES[k] + '</span><span class="crit-val">' + esc(valueText(z, k)) + '</span></div>' +
        '<span class="pill ' + quality(z, k) + '">' + LV[k][z.lv[k]] + '</span></div>';
    }).join('');
  }

  function robustInfo(z) {
    var d = z.r - z.sr;
    var robust = Math.abs(d) <= Math.max(1, Math.round(N * 0.05));
    var delta = d === 0 ? 'même rang' : (d > 0 ? 'gagne ' + fmt(d) + ' ' + plural(d, 'place', 'places') : 'perd ' + fmt(-d) + ' ' + plural(-d, 'place', 'places'));
    return { robust: robust, delta: delta };
  }

  function selected() { return state.sel === null ? null : Z[state.sel]; }

  function renderFiche() {
    var z = selected(), body = $('fiche-body');
    if (!z) {
      body.innerHTML = '<p class="muted">Cliquez sur une zone de la carte ou de la liste des meilleures zones : sa fiche s’affiche ici.</p>';
      return;
    }
    var k = clsOf(z);
    var h = '<div class="f-title"><span class="f-commune">' + esc(z.c) + '</span><span class="muted small">' + esc(DEPTS[z.dp] || '') + ' (' + z.dp + '), zone n° ' + (z.id + 1) + '</span></div>' +
      '<div class="f-badge"><span class="sw" style="background:' + COLORS[k] + '"></span><div><strong>' + CLS[k] + '</strong><span>' + VERDICT[k] + '</span></div></div>' +
      '<div class="f-ranks"><div class="f-line"><span>Rang dans l’analyse de référence</span><strong>' + fmt(z.r) + ' sur ' + fmt(N) + '</strong></div>';
    if (isSim()) {
      var ri = robustInfo(z);
      h += '<div class="f-line"><span>Rang avec vos priorités</span><strong>' + fmt(z.sr) + ' (' + ri.delta + ')</strong></div>' +
        (ri.robust ? '<span class="f-note good">Zone robuste : son rang change peu selon les priorités.</span>' : '<span class="f-note bad">Zone sensible aux critères : son rang dépend fortement des priorités.</span>');
    }
    h += '</div><div class="f-crits">' + critHtml(z) + '</div>' +
      '<div class="f-actions"><button type="button" class="btn btn-dark" id="btn-alt">Trouver de meilleures alternatives</button>' +
      '<button type="button" class="btn" id="btn-pdf">Voir et télécharger la fiche</button></div>';
    body.innerHTML = h;
    $('btn-alt').onclick = function () { state.alt = 'choose'; renderAlt(); openModal('modal-alt'); };
    $('btn-pdf').onclick = openPdf;
  }

  function renderFullSel() {
    var z = selected(), el = $('full-sel');
    if (!state.full || !z) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = '<span><strong>' + esc(z.c) + '</strong><span class="muted small">' + CLS[clsOf(z)] + ', rang ' + fmt(rankOf(z)) + '</span></span>' +
      '<button type="button" class="btn btn-dark btn-small" id="btn-full-open">Ouvrir la fiche</button>';
    $('btn-full-open').onclick = function () { setFull(false); setTimeout(function () { $('fiche').scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50); };
  }

  function exportList() {
    if (!$('chk-all').checked) return visibleList();
    var out = Z.slice();
    out.sort(function (a, c) { return rankOf(a) - rankOf(c); });
    return out;
  }
  function renderBand(vis) {
    var all = $('chk-all').checked, n = all ? N : vis.length;
    var quoi = all ? 'toutes les zones, sans tenir compte de vos réglages'
      : (n === N ? 'toutes les zones (aucun filtre appliqué)' : 'les zones affichées avec vos filtres actuels');
    $('band-text').textContent = fmt(n) + ' ' + plural(n, 'zone', 'zones') + ' : ' + quoi + ', classées selon ' + (isSim() ? 'votre simulation' : 'l’analyse de référence') + '. Avec une notice : sources, date et réglages utilisés.';
  }

  function renderClassToggles() {
    $('class-toggles').innerHTML = [4, 3, 2, 1, 0].map(function (k) {
      var off = !!state.hidden[k];
      return '<label class="ctoggle' + (off ? ' off' : '') + '"><input type="checkbox" data-k="' + k + '"' + (off ? '' : ' checked') + '>' +
        '<span class="sw" style="background:' + COLORS[k] + '"></span><span class="lbl">' + CLS[k] + '</span><span class="rng">' + RANGES[k] + '</span></label>';
    }).join('');
  }

  function renderAll() {
    renderMode();
    var vis = visibleList();
    renderTop(vis);
    renderFiche();
    renderFullSel();
    renderBand(vis);
    renderClassToggles();
    updateSelLayer();
  }

  // ---------- Construction des réglages ----------
  function buildSettings() {
    var sd = $('sel-dept');
    sd.innerHTML = '<option value="all">Tous les départements</option>' + DEPT_ORDER.map(function (d) { return '<option value="' + d + '">' + DEPTS[d] + ' (' + d + ')</option>'; }).join('');
    sd.onchange = function () {
      state.dept = sd.value; state.sel = null; apply();
      var b = state.dept === 'all' ? META.bbox : deptBox[state.dept];
      if (map && b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 30, duration: 800 });
    };

    $('weights-ref').innerHTML = KEYS.map(function (k) {
      return '<div class="wrow"><div class="wrow-text"><span class="wrow-name">' + NAMES[k] + '</span><span class="muted small">' + MEAS[k] + '</span></div><span class="wrow-pct">' + REFW[k] + ' %</span></div>';
    }).join('');

    $('sliders').innerHTML = KEYS.map(function (k) {
      return '<div class="slider"><div class="slider-top"><label for="imp-' + k + '">' + NAMES[k] + '</label><span><strong id="val-' + k + '">' + state.imp[k] + '</strong> sur 100, soit <span id="pct-' + k + '"></span> % du score</span></div>' +
        '<input id="imp-' + k + '" type="range" min="0" max="100" step="5" value="' + state.imp[k] + '" data-k="' + k + '">' +
        '<div class="slider-scale" aria-hidden="true"><span>Ignoré</span><span>Faible</span><span>Moyenne</span><span>Forte</span><span>Décisive</span></div></div>';
    }).join('');
    var simTimer = null;
    KEYS.forEach(function (k) {
      $('imp-' + k).addEventListener('input', function (e) {
        state.imp[k] = Number(e.target.value); renderSliderLabels();
        clearTimeout(simTimer); simTimer = setTimeout(function () { computeSim(); apply(); }, 180);
      });
    });
    $('btn-reset').onclick = function () { state.imp = { acc: 35, pa: 30, dens: 20, conc: 15 }; renderSliderLabels(); computeSim(); apply(); };
    renderSliderLabels();

    $('profile').innerHTML = KEYS.map(function (k) {
      return '<label class="prow">' + NAMES[k] + '<select data-k="' + k + '">' + PROF[k].map(function (o, i) { return '<option value="' + i + '">' + o[0] + '</option>'; }).join('') + '</select></label>';
    }).join('');
    Array.prototype.forEach.call($('profile').querySelectorAll('select'), function (s) {
      s.onchange = function () { state.prof[s.dataset.k] = Number(s.value); apply(); };
    });

    $('class-toggles').addEventListener('change', function (e) {
      var k = e.target.dataset.k; if (k === undefined) return;
      state.hidden[k] = !e.target.checked; apply();
    });

    $('legend').innerHTML = [4, 3, 2, 1, 0].map(function (k) { return '<span><span class="sw sw-s" style="background:' + COLORS[k] + '"></span>' + CLS[k] + '</span>'; }).join('') ;

    $('btn-ref').onclick = function () { state.mode = 'ref'; apply(); };
    $('btn-sim').onclick = function () { state.mode = 'sim'; computeSim(); apply(); };
    $('mode-hint-sim').onclick = function () { state.mode = 'ref'; apply(); };
    $('chk-oneper').onchange = function (e) { state.onePer = e.target.checked; renderAll(); };
    $('chk-all').onchange = function () { renderBand(visibleList()); };
    $('top-list').addEventListener('click', function (e) {
      var b = e.target.closest('.top-item'); if (!b) return;
      select(Number(b.dataset.id), true);
    });

    // Liste des communes pour la recherche
    var names = Object.keys(byCommune).map(function (n) { return Z[byCommune[n][0]].c; }).sort(function (a, b) { return a.localeCompare(b, 'fr'); });
    $('list-communes').innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
    $('form-search').onsubmit = function (e) { e.preventDefault(); search($('inp-search').value); };
  }

  // ---------- Sélection et déplacements ----------
  function select(id, fly) {
    state.sel = id; state.alt = null;
    renderAll();
    if (fly) flyTo(Z[id]);
    if (window.matchMedia('(max-width: 1260px)').matches && !state.full) $('fiche').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function flyTo(z) { if (map) map.flyTo({ center: [z.lon, z.lat], zoom: Math.max(map.getZoom(), 13), duration: 900 }); }

  function updateSelLayer() {
    if (!mapReady) return;
    map.setFilter('zones-sel', ['==', ['id'], state.sel === null ? -1 : state.sel]);
  }

  function nearestZone(lon, lat) {
    var best = null, bd = Infinity, cos = Math.cos(lat * Math.PI / 180);
    for (var i = 0; i < N; i++) {
      var dx = (Z[i].lon - lon) * cos, dy = Z[i].lat - lat, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = Z[i]; }
    }
    return { z: best, km: Math.sqrt(bd) * 111.32 };
  }

  function search(q) {
    q = q.trim(); if (!q) return;
    var hit = byCommune[norm(q)];
    if (hit) {
      var xs = hit.map(function (i) { return Z[i]; });
      var b = [180, 90, -180, -90];
      xs.forEach(function (z) { b[0] = Math.min(b[0], z.lon); b[1] = Math.min(b[1], z.lat); b[2] = Math.max(b[2], z.lon); b[3] = Math.max(b[3], z.lat); });
      var best = xs.slice().sort(function (a, c) { return rankOf(a) - rankOf(c); })[0];
      if (map) map.fitBounds([[b[0] - 0.01, b[1] - 0.01], [b[2] + 0.01, b[3] + 0.01]], { padding: 40, maxZoom: 14, duration: 800 });
      state.sel = best.id; state.alt = null; renderAll();
      toast(xs.length + ' ' + plural(xs.length, 'zone étudiée', 'zones étudiées') + ' à ' + best.c + ' : la mieux classée est sélectionnée.');
      return;
    }
    geocode(q).then(function (pt) {
      if (!pt) { toast('Adresse introuvable. Essayez avec le nom de la commune.'); return; }
      var b = META.bbox;
      if (pt[0] < b[0] - 0.2 || pt[0] > b[2] + 0.2 || pt[1] < b[1] - 0.2 || pt[1] > b[3] + 0.2) { toast('Cette adresse est hors de la zone d’étude (Pays de la Loire et Bretagne).'); return; }
      var nz = nearestZone(pt[0], pt[1]);
      if (map) map.flyTo({ center: pt, zoom: 14, duration: 900 });
      state.sel = nz.z.id; state.alt = null; renderAll();
      if (nz.km > 0.4) toast('Aucune zone étudiée à cette adresse : la plus proche, à ' + fr1(nz.km) + ' km, est sélectionnée.');
    }).catch(function () { toast('Le service de recherche d’adresse ne répond pas. Essayez avec le nom de la commune.'); });
  }

  function geocode(q) {
    var u1 = 'https://data.geopf.fr/geocodage/search?limit=1&q=' + encodeURIComponent(q);
    var u2 = 'https://api-adresse.data.gouv.fr/search/?limit=1&q=' + encodeURIComponent(q);
    function get(u) {
      return fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (j) {
        return j.features && j.features.length ? j.features[0].geometry.coordinates : null;
      });
    }
    return get(u1).catch(function () { return get(u2); });
  }

  // ---------- Plein écran ----------
  function setFull(on) {
    state.full = on;
    $('map-card').classList.toggle('full', on);
    document.body.classList.toggle('no-scroll', on);
    $('btn-full').setAttribute('aria-pressed', String(on));
    $('btn-full-label').textContent = on ? 'Réduire la carte' : 'Agrandir la carte';
    renderFullSel();
    if (map) setTimeout(function () { map.resize(); }, 30);
  }

  // ---------- Fenêtres ----------
  var lastFocus = null;
  function openModal(id) { lastFocus = document.activeElement; $(id).hidden = false; var f = $(id).querySelector('button'); if (f) f.focus(); }
  function closeModal(el) { el.hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  document.addEventListener('click', function (e) {
    if (e.target.matches('[data-close]')) {
      var m = e.target.closest('.modal');
      if (m.id === 'modal-onb') markOnbSeen();
      closeModal(m);
    } else if (e.target.classList && e.target.classList.contains('modal')) {
      if (e.target.id === 'modal-onb') markOnbSeen();
      closeModal(e.target);
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = Array.prototype.filter.call(document.querySelectorAll('.modal'), function (m) { return !m.hidden; });
    if (open.length) { var m = open[open.length - 1]; if (m.id === 'modal-onb') markOnbSeen(); closeModal(m); }
    else if (state.full) setFull(false);
  });
  function markOnbSeen() { /* plus de mémorisation : la présentation revient à chaque ouverture */ }

  // ---------- Alternatives ----------
  function renderAlt() {
    var z = selected(); if (!z) return;
    $('alt-sub').textContent = 'Autour de la zone choisie à ' + z.c + ', dans un rayon de 5 km';
    var h = '<div style="display:flex;flex-direction:column;gap:8px"><span style="font-size:15px;font-weight:500">Sur quel critère cette zone ne vous satisfait-elle pas ?</span><div class="alt-choices">' +
      KEYS.map(function (k) {
        var on = state.alt === k;
        return '<button type="button" class="btn" data-alt="' + k + '" aria-pressed="' + on + '">' + NAMES[k] + (on ? '' : ' : ' + lvShort(k, z.lv[k])) + '</button>';
      }).join('') + '</div></div>';
    if (state.alt && state.alt !== 'choose') {
      var crit = state.alt;
      var cands = [];
      for (var i = 0; i < N; i++) {
        var c = Z[i];
        if (c.id === z.id || c.lv[crit] <= z.lv[crit]) continue;
        if (!KEYS.every(function (k) { return k === crit || c.lv[k] >= z.lv[k]; })) continue;
        var d = dist(c, z); if (d > ALT_RADIUS) continue;
        cands.push({ z: c, d: d });
      }
      cands.sort(function (a, b) { return rankOf(a.z) - rankOf(b.z); });
      cands = cands.slice(0, 3);
      h += '<p class="muted small" style="margin:0">Zones qui font mieux sur ce critère sans faire moins bien sur les trois autres, classées selon le mode en cours.</p>';
      h += '<div class="alt-grid">' + altCol(z, null, 'Zone de départ', crit) + cands.map(function (o, i) { return altCol(o.z, o.d, 'Alternative ' + (i + 1), crit); }).join('') + '</div>';
      if (!cands.length) h += '<p class="muted" style="margin:0;font-size:14px">Aucune zone à moins de 5 km ne fait mieux sur ce critère sans perdre ailleurs : cette zone est déjà un bon compromis.</p>';
    }
    $('alt-body').innerHTML = h;
    $('alt-body').style.display = 'flex'; $('alt-body').style.flexDirection = 'column'; $('alt-body').style.gap = '16px';
  }
  function altCol(z, d, tag, crit) {
    var k = clsOf(z), f = [], w = [];
    KEYS.forEach(function (kk) { var q = quality(z, kk); if (q === 'good') f.push(NAMES[kk].toLowerCase()); if (q === 'weak') w.push(NAMES[kk].toLowerCase()); });
    return '<div class="alt-col' + (d === null ? ' start' : '') + '"><div style="display:flex;flex-direction:column;gap:2px"><span class="tag">' + tag + '</span><span class="name">' + esc(z.c) + '</span>' +
      '<span class="muted small">Rang ' + fmt(rankOf(z)) + ', ' + (d === null ? 'zone de départ' : 'à ' + fr1(d / 1000) + ' km') + '</span></div>' +
      '<span style="display:flex;align-items:center;gap:6px;font-size:14px;font-weight:500"><span class="sw sw-s" style="background:' + COLORS[k] + '"></span>' + CLS[k] + '</span>' +
      KEYS.map(function (kk) { return '<div class="alt-k"><span>' + NAMES[kk] + '</span><span' + (d !== null && kk === crit ? ' class="better"' : '') + '>' + LV[kk][z.lv[kk]] + '</span></div>'; }).join('') +
      '<div class="alt-ff"><span>Points forts : ' + (f.length ? f.join(', ') : 'aucun') + '</span><span>Points faibles : ' + (w.length ? w.join(', ') : 'aucun') + '</span></div>' +
      (d !== null ? '<button type="button" class="btn btn-small" data-pick="' + z.id + '">Afficher sa fiche</button>' : '') + '</div>';
  }
  $('alt-body').addEventListener('click', function (e) {
    var a = e.target.closest('[data-alt]');
    if (a) { state.alt = a.dataset.alt; renderAlt(); return; }
    var p = e.target.closest('[data-pick]');
    if (p) { closeModal($('modal-alt')); select(Number(p.dataset.pick), true); }
  });

  // ---------- Aperçu et PDF de la fiche ----------
  function pdfHtml(z, img) {
    var k = clsOf(z);
    var w = state.imp, sum = w.acc + w.pa + w.dens + w.conc;
    var modeTxt = isSim()
      ? 'Mode simulation, poids choisis : accès routier ' + Math.round(w.acc / sum * 100) + ' %, pouvoir d’achat ' + Math.round(w.pa / sum * 100) + ' %, population ' + Math.round(w.dens / sum * 100) + ' %, concurrence ' + Math.round(w.conc / sum * 100) + ' %. Rang avec ces poids : ' + fmt(z.sr) + ' sur ' + fmt(N) + '.'
      : 'Poids de l’analyse de référence : accès routier 35 %, pouvoir d’achat 30 %, population 20 %, concurrence 15 %.';
    var date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    return '<header class="pdf-head"><div><span class="muted small">Fiche zone, implantation d’un restaurant rapide</span><span class="pdf-commune">' + esc(z.c) + '</span>' +
      '<span class="muted" style="font-size:14px">' + esc(DEPTS[z.dp] || '') + ' (' + z.dp + '), zone n° ' + (z.id + 1) + ' (500 m sur 500 m)</span></div>' +
      '<div class="pdf-cls"><span class="sw" style="background:' + COLORS[k] + '"></span>' + CLS[k] + '</div></header>' +
      (img ? '<img class="pdf-map" src="' + img + '" alt="Carte de situation de la zone">' : '') +
      '<p>' + VERDICT[k] + ' Rang ' + fmt(z.r) + ' sur ' + fmt(N) + ' zones dans l’analyse de référence.</p>' +
      '<table class="pdf-table"><thead><tr><th>Critère</th><th>Niveau</th><th>Valeur</th></tr></thead><tbody>' +
      KEYS.map(function (kk) { return '<tr><td>' + NAMES[kk] + '</td><td style="font-weight:500">' + LV[kk][z.lv[kk]] + '</td><td>' + esc(valueText(z, kk)) + '</td></tr>'; }).join('') +
      '</tbody></table>' +
      '<p class="note">' + modeTxt + ' Cette fiche aide à repérer une zone ; elle ne remplace ni une visite sur place, ni l’étude du local commercial (surface, loyer, bail).</p>' +
      '<p class="src">Sources : IGN, Géoportail de l’urbanisme, INPN, Géorisques, base SIRENE, Insee Filosofi 2021. Fond de carte : ' + FOND_NOMS[fondActif] + '. Fiche éditée le ' + date + '.</p>';
  }
  function openPdf() {
    var z = selected(); if (!z) return;
    $('pdf-article').innerHTML = pdfHtml(z, null);
    openModal('modal-pdf');
    if (!map) return;
    map.jumpTo({ center: [z.lon, z.lat], zoom: 13.2 });
    var done = false;
    function snap() {
      if (done) return; done = true;
      var img = null;
      try { img = map.getCanvas().toDataURL('image/jpeg', 0.85); } catch (err) { img = null; }
      if (img && img.length < 5000) img = null; // image vide
      if (!$('modal-pdf').hidden && state.sel === z.id) $('pdf-article').innerHTML = pdfHtml(z, img);
    }
    map.once('idle', snap);
    setTimeout(function () { map.triggerRepaint(); map.once('render', snap); }, 4000); // repli si le fond tarde
  }
  $('btn-print').onclick = function () {
    var z = selected(); var t = document.title;
    if (z) document.title = 'Fiche zone ' + z.c;
    window.print();
    setTimeout(function () { document.title = t; }, 500);
  };

  // ---------- Téléchargements ----------
  function noticeLines(vis) {
    var w = state.imp, sum = w.acc + w.pa + w.dens + w.conc;
    var poids = isSim()
      ? 'accès routier ' + Math.round(w.acc / sum * 100) + ' %, pouvoir d’achat ' + Math.round(w.pa / sum * 100) + ' %, population ' + Math.round(w.dens / sum * 100) + ' %, concurrence ' + Math.round(w.conc / sum * 100) + ' %'
      : 'accès routier 35 %, pouvoir d’achat 30 %, population 20 %, concurrence 15 %';
    var prof = KEYS.map(function (k) { return NAMES[k] + ' : ' + PROF[k][state.prof[k]][0].toLowerCase(); }).join(' ; ');
    var hid = [4, 3, 2, 1, 0].filter(function (k) { return state.hidden[k]; }).map(function (k) { return CLS[k]; });
    return [
      ['Étude', 'Implantation d’un restaurant rapide (NAF 56.10C), Pays de la Loire et Bretagne'],
      ['Date de l’export', new Date().toLocaleString('fr-FR')],
      ['Mode', isSim() ? 'Simulation' : 'Analyse de référence'],
      ['Poids', poids],
      ['Territoire', state.dept === 'all' ? 'Tous les départements' : DEPTS[state.dept] + ' (' + state.dept + ')'],
      ['Profil de zone', prof],
      ['Classes masquées', hid.length ? hid.join(', ') : 'aucune'],
      ['Zones exportées', $('chk-all').checked ? 'toutes les zones, réglages non appliqués' : 'votre sélection, réglages appliqués'],
      ['Nombre de zones', String(vis.length)],
      ['Grille', 'Carreaux de 500 m en Lambert-93 (EPSG:2154), zones éligibles uniquement'],
      ['Score', 'Somme pondérée des critères normalisés (min-max) ; concurrence = 1 moins l’indice de Huff normalisé'],
      ['Classes', 'Prioritaire 1 %, très favorable 1 à 5 %, favorable 5 à 20 %, moyen 20 à 50 %, peu favorable 50 à 100 %'],
      ['Sources', 'IGN Géoplateforme, Géoportail de l’urbanisme, INPN, Géorisques, API Recherche d’entreprises (base SIRENE), Insee Filosofi 2021'],
      ['Avertissement', 'Outil d’aide au repérage : il ne remplace ni une visite sur place, ni l’étude du local commercial (surface, loyer, bail).']
    ];
  }
  function rowOf(z) {
    return {
      'Rang (mode en cours)': rankOf(z),
      'Rang de référence': z.r,
      'Classe': CLS[clsOf(z)],
      'Commune': z.c,
      'Code INSEE': z.ic,
      'Département': DEPTS[z.dp] || z.dp,
      'Score de référence (sur 100)': Math.round(z.s * 1000) / 10,
      'Score de simulation (sur 100)': isSim() ? Math.round(z.ss * 1000) / 10 : '',
      'Distance à la route principale (m)': z.dr,
      'Niveau de vie moyen (€ par an)': z.nv === null ? 'non diffusé' : z.nv,
      'Densité (hab. au km²)': z.de,
      'Population de la zone': z.po,
      'Fast-foods à moins de 2 km': z.nc,
      'Longitude': Math.round(z.lon * 1e5) / 1e5,
      'Latitude': Math.round(z.lat * 1e5) / 1e5
    };
  }
  function stamp() { var d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); }
  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  var sheetPromise = null;
  function loadSheetJS() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (sheetPromise) return sheetPromise;
    sheetPromise = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = SHEETJS; s.onload = function () { res(window.XLSX); }; s.onerror = rej; document.head.appendChild(s);
    });
    return sheetPromise;
  }
  $('btn-xlsx').onclick = function () {
    var vis = exportList(); if (!vis.length) { toast('Aucune zone à exporter avec ces réglages.'); return; }
    var btn = $('btn-xlsx'); btn.disabled = true;
    var rows = vis.map(rowOf), notice = noticeLines(vis);
    loadSheetJS().then(function (X) {
      var wb = X.utils.book_new();
      var ws = X.utils.json_to_sheet(rows);
      ws['!cols'] = Object.keys(rows[0]).map(function (h) { return { wch: Math.max(12, Math.min(34, h.length + 2)) }; });
      X.utils.book_append_sheet(wb, ws, 'Zones');
      var wn = X.utils.aoa_to_sheet([['Rubrique', 'Contenu']].concat(notice));
      wn['!cols'] = [{ wch: 20 }, { wch: 110 }];
      X.utils.book_append_sheet(wb, wn, 'Notice');
      X.writeFile(wb, 'zones-fastfood-' + (isSim() ? 'simulation' : 'reference') + '-' + stamp() + '.xlsx');
    }).catch(function () {
      // Repli : CSV lisible par Excel
      var heads = Object.keys(rows[0]);
      var q = function (v) { v = String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      var lines = notice.map(function (n) { return q('# ' + n[0] + ' : ' + n[1]); });
      lines.push(heads.map(q).join(';'));
      rows.forEach(function (r) { lines.push(heads.map(function (h) { return q(typeof r[h] === 'number' ? String(r[h]).replace('.', ',') : r[h]); }).join(';')); });
      download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'zones-fastfood-' + stamp() + '.csv');
      toast('Le fichier Excel n’a pas pu être préparé : un fichier CSV, lisible par Excel, a été téléchargé à la place.');
    }).then(function () { btn.disabled = false; });
  };
  $('btn-geo').onclick = function () {
    var vis = exportList(); if (!vis.length) { toast('Aucune zone à exporter avec ces réglages.'); return; }
    var notice = {}; noticeLines(vis).forEach(function (n) { notice[n[0]] = n[1]; });
    var fc = { type: 'FeatureCollection', notice: notice, features: vis.map(function (z) { return { type: 'Feature', geometry: z.geom, properties: rowOf(z) }; }) };
    download(new Blob([JSON.stringify(fc)], { type: 'application/geo+json' }), 'zones-fastfood-' + (isSim() ? 'simulation' : 'reference') + '-' + stamp() + '.geojson');
    toast('Données téléchargées au format GeoJSON (WGS84), lisible dans QGIS.');
  };

  // ---------- Carte ----------
  function initMap(data) {
    if (!window.maplibregl) { $('map-loading').textContent = 'La bibliothèque de carte n’a pas pu être chargée. Vérifiez votre connexion.'; return; }
    var b = META.bbox;
    map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {
          ign: { type: 'raster', tiles: [IGN_TILES], tileSize: 256, maxzoom: 19, attribution: '© <a href="https://www.ign.fr/" target="_blank" rel="noopener">IGN</a>, Plan IGN' },
          ortho: { type: 'raster', tiles: [ORTHO_TILES], tileSize: 256, maxzoom: 19, attribution: '© <a href="https://www.ign.fr/" target="_blank" rel="noopener">IGN</a>, photographies aériennes' }
        },
        layers: [
          { id: 'fond', type: 'background', paint: { 'background-color': '#EEF0EE' } },
          { id: 'ign', type: 'raster', source: 'ign', paint: { 'raster-saturation': -0.7, 'raster-opacity': 0.85 } },
          { id: 'ortho', type: 'raster', source: 'ortho', layout: { visibility: 'none' }, paint: { 'raster-saturation': -0.2 } }
        ]
      },
      bounds: [[b[0], b[1]], [b[2], b[3]]],
      fitBoundsOptions: { padding: 20 },
      maxBounds: [[b[0] - 3, b[1] - 2], [b[2] + 3, b[3] + 2]],
      minZoom: 6,
      maxZoom: 17,
      preserveDrawingBuffer: true,
      attributionControl: { compact: true }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    $('basemap').addEventListener('click', function (e) {
      var b = e.target.closest('[data-fond]'); if (!b) return;
      fondActif = b.dataset.fond;
      FONDS.forEach(function (f) { map.setLayoutProperty(f, 'visibility', f === b.dataset.fond ? 'visible' : 'none'); });
      Array.prototype.forEach.call($('basemap').querySelectorAll('[data-fond]'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    });
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.on('load', function () {
      map.addSource('zones', { type: 'geojson', data: data });
      var colorExpr = ['match', ['coalesce', ['feature-state', 'k'], -1], 4, COLORS[4], 3, COLORS[3], 2, COLORS[2], 1, COLORS[1], 0, COLORS[0], '#CCCCCC'];
      map.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: {
        'fill-color': colorExpr,
        'fill-opacity': ['case', ['boolean', ['feature-state', 'v'], true], 0.85, 0],
        'fill-antialias': false
      } });
      // À petite échelle, un léger contour de la même couleur rend les carreaux lisibles
      map.addLayer({ id: 'zones-halo', type: 'line', source: 'zones', maxzoom: 10, paint: {
        'line-color': colorExpr, 'line-width': 1.2,
        'line-opacity': ['case', ['boolean', ['feature-state', 'v'], true], 0.85, 0]
      } });
      map.addLayer({ id: 'zones-line', type: 'line', source: 'zones', minzoom: 10.5, paint: { 'line-color': '#FFFFFF', 'line-width': 0.6, 'line-opacity': ['case', ['boolean', ['feature-state', 'v'], true], 0.7, 0] } });
      map.addLayer({ id: 'zones-hover', type: 'line', source: 'zones', filter: ['==', ['id'], -1], paint: { 'line-color': '#14201F', 'line-width': 1.5 } });
      map.addLayer({ id: 'zones-sel', type: 'line', source: 'zones', filter: ['==', ['id'], -1], paint: { 'line-color': '#14201F', 'line-width': 3.5 } });
      mapReady = true;
      for (var i = 0; i < N; i++) { Z[i]._k = undefined; Z[i]._v = undefined; }
      apply();
      $('map-loading').hidden = true;
    });
    popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    function zoneVisible(e) {
      for (var i = 0; i < e.features.length; i++) { if (Z[e.features[i].id] && Z[e.features[i].id]._v) return e.features[i]; }
      return null;
    }
    map.on('mousemove', 'zones-fill', function (e) {
      var f = zoneVisible(e);
      if (!f) { map.getCanvas().style.cursor = ''; hoverId = null; map.setFilter('zones-hover', ['==', ['id'], -1]); popup.remove(); return; }
      map.getCanvas().style.cursor = 'pointer';
      if (hoverId !== f.id) { hoverId = f.id; map.setFilter('zones-hover', ['==', ['id'], hoverId]); }
      var z = Z[f.id];
      popup.setLngLat(e.lngLat).setHTML('<strong>' + esc(z.c) + '</strong><br>' + CLS[clsOf(z)] + ', rang ' + fmt(rankOf(z))).addTo(map);
    });
    map.on('mouseleave', 'zones-fill', function () {
      map.getCanvas().style.cursor = ''; hoverId = null; map.setFilter('zones-hover', ['==', ['id'], -1]); popup.remove();
    });
    map.on('click', 'zones-fill', function (e) { var f = zoneVisible(e); if (f) select(f.id, false); });
    map.on('error', function (e) { if (e && e.error && /zones/.test(String(e.sourceId))) $('map-loading').textContent = 'Erreur d’affichage des zones.'; });
  }

  // ---------- Démarrage ----------
  function centroid(geom) {
    var ring = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
    var sx = 0, sy = 0, n = ring.length - 1;
    for (var i = 0; i < n; i++) { sx += ring[i][0]; sy += ring[i][1]; }
    return [sx / n, sy / n];
  }

  function init(data) {
    META = data.meta; N = META.n; CUTS = META.seuilsRang; MED = META.medianeNiveauVie;
    $('n-elig').textContent = fmt(N);
    Z = [];
    data.features.forEach(function (f) {
      var p = f.properties, c = centroid(f.geometry);
      var z = { id: f.id, r: p.r, s: p.s, a: p.a, p: p.p, d: p.d, h: p.h, dr: p.dr, nv: p.nv, de: p.de, nc: p.nc, po: p.po, c: p.c, ic: p.ic, dp: p.dp, x: p.x, y: p.y, lon: c[0], lat: c[1], geom: f.geometry };
      z.k = classOfRank(z.r);
      z.lv = levels(z);
      var key = norm(z.c);
      (byCommune[key] = byCommune[key] || []).push(Z.length);
      var db = deptBox[z.dp] = deptBox[z.dp] || [180, 90, -180, -90];
      db[0] = Math.min(db[0], c[0]); db[1] = Math.min(db[1], c[1]); db[2] = Math.max(db[2], c[0]); db[3] = Math.max(db[3], c[1]);
      Z.push(z);
    });
    // Les identifiants doivent correspondre aux index
    Z.forEach(function (z, i) { if (z.id !== i) throw new Error('identifiants non contigus'); });
    buildSettings();
    computeSim();
    apply();
    initMap(data);
  }

  $('btn-guide').onclick = function () { openModal('modal-guide'); };
  $('btn-aide').onclick = function () { openModal('modal-onb'); };
  $('btn-onb-guide').onclick = function () { markOnbSeen(); $('modal-onb').hidden = true; openModal('modal-guide'); };
  $('btn-full').onclick = function () { setFull(!state.full); };
  // Réajuste la liste quand la largeur de la fenêtre change
  var resizeTimer = null;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { if (N) renderTop(visibleList()); }, 200); });

  // L'écran de présentation s'affiche à chaque ouverture de la page
  openModal('modal-onb');

  // Les données viennent de data/zones.js (fonctionne aussi en double-clic) ; sinon, lecture du GeoJSON
  var source = window.ZONES_DATA
    ? Promise.resolve(window.ZONES_DATA)
    : fetch('data/zones.geojson').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  source
    .then(init)
    .catch(function (err) {
      $('map-loading').textContent = 'Les données n’ont pas pu être chargées (' + err.message + '). Vérifiez que le dossier data contient zones.js.';
      console.error(err);
    });
})();

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  return {
    fill: v('--map-fill'),
    fillHover: v('--map-hover'),
    correct: v('--map-correct'),
    wrong: v('--map-wrong'),
    yellow: v('--map-yellow'),
    orange: v('--map-orange'),
    stroke: v('--map-stroke'),
    strokeActive: v('--map-stroke-active'),
    accent: v('--accent'),
  };
}

let COLORS = readColors();

const state = {
  features: [],
  layers: new Map(),
  hitboxes: new Map(),
  mode: 'quiz',
  queue: [],
  index: 0,
  correct: 0,
  mistakes: [],
  answered: false,
  labelsOn: false,
  selectedCode: null,
  attempts: 0,
  revealed: false,
  wrongClicks: new Set(),
  labelTimers: [],
  marks: new Map(),
  timer: null,
};

const dom = {
  promptName: document.getElementById('prompt-name'),
  promptBox: document.getElementById('prompt'),
  feedback: document.getElementById('feedback'),
  feedbackIcon: document.querySelector('.feedback__icon'),
  feedbackText: document.querySelector('.feedback__text'),
  progressFill: document.getElementById('progress-fill'),
  progressText: document.getElementById('progress-text'),
  progressPct: document.getElementById('progress-pct'),
  statCorrect: document.getElementById('stat-correct'),
  statWrong: document.getElementById('stat-wrong'),
  statBest: document.getElementById('stat-best'),
  infoCard: document.getElementById('info-card'),
  modal: document.getElementById('modal'),
  modalRing: document.getElementById('modal-ring'),
  modalTitle: document.getElementById('modal-title'),
  modalScore: document.getElementById('modal-score'),
  modalSub: document.getElementById('modal-sub'),
  modalReview: document.getElementById('modal-review'),
  reviewList: document.getElementById('review-list'),
  answerSelect: document.getElementById('kbd-answer'),
};

let map;
let geojsonLayer;
let lastFocused = null;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const nameOf = (code) => state.layers.get(code).feature.properties.name;

const prefersReduced = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function clearTimer() {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

function getBest() {
  try {
    return JSON.parse(localStorage.getItem('regiony-best') || 'null');
  } catch {
    return null;
  }
}

function bestPct(best) {
  if (!best) return -1;
  if (typeof best.pct === 'number') return best.pct;
  const total = best.total || 59;
  return Math.round((best.correct / total) * 100);
}

function updateStats() {
  const best = getBest();
  dom.statCorrect.textContent = state.correct;
  dom.statWrong.textContent = state.mistakes.length;
  if (best) {
    const total = best.total || 59;
    dom.statBest.textContent = `${best.correct}/${total}`;
    dom.statBest.title = `Rekord: ${best.correct} / ${total} (${bestPct(best)}%)`;
  } else {
    dom.statBest.textContent = 'brak';
    dom.statBest.title = 'Brak wyniku';
  }
}

const FEEDBACK_CLASS = { correct: 'is-correct', wrong: 'is-wrong' };

function setFeedback(kind, text, icon) {
  dom.feedback.classList.remove('is-correct', 'is-wrong');
  if (kind && FEEDBACK_CLASS[kind]) dom.feedback.classList.add(FEEDBACK_CLASS[kind]);
  dom.feedbackIcon.textContent = icon || '';
  dom.feedbackText.textContent = text || '';
}

function flashPrompt() {
  dom.promptBox.classList.remove('is-pop');
  void dom.promptBox.offsetWidth;
  dom.promptBox.classList.add('is-pop');
}

const PROMPT_MAX = 28;
const PROMPT_MIN = 17;

function fitPromptName() {
  const el = dom.promptName;
  if (!el || el.clientWidth === 0) return;
  let size = PROMPT_MAX;
  el.style.fontSize = size + 'px';
  const fits = () => {
    const lh = parseFloat(getComputedStyle(el).lineHeight) || size * 1.12;
    return el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().height <= lh * 2 + 2;
  };
  while (size > PROMPT_MIN && !fits()) {
    size -= 1;
    el.style.fontSize = size + 'px';
  }
}

/* ------------------------------------------------------------------ */
/* Map                                                                 */
/* ------------------------------------------------------------------ */

function baseStyle() {
  return {
    className: 'region-path',
    color: COLORS.stroke,
    weight: 1,
    fillColor: COLORS.fill,
    fillOpacity: 0.92,
  };
}

function setLayerState(code, kind) {
  const layer = state.layers.get(code);
  if (!layer) return;
  const path = layer._path;
  if (path) path.classList.toggle('is-reveal', kind === 'reveal');
  if (kind === 'correct') {
    layer.setStyle({ fillColor: COLORS.correct, fillOpacity: 1, color: COLORS.strokeActive, weight: 2 });
    layer.bringToFront();
  } else if (kind === 'yellow') {
    layer.setStyle({ fillColor: COLORS.yellow, fillOpacity: 1, color: COLORS.strokeActive, weight: 2 });
    layer.bringToFront();
  } else if (kind === 'orange') {
    layer.setStyle({ fillColor: COLORS.orange, fillOpacity: 1, color: COLORS.strokeActive, weight: 2 });
    layer.bringToFront();
  } else if (kind === 'wrong') {
    layer.setStyle({ fillColor: COLORS.wrong, fillOpacity: 1, color: COLORS.strokeActive, weight: 2 });
    layer.bringToFront();
  } else if (kind === 'reveal') {
    layer.setStyle({ fillColor: COLORS.wrong, fillOpacity: 1, color: COLORS.strokeActive, weight: 2 });
    layer.bringToFront();
  } else if (kind === 'muted') {
    layer.setStyle({ fillColor: COLORS.fill, fillOpacity: 0.25, color: COLORS.stroke, weight: 1 });
  } else {
    layer.setStyle(baseStyle());
  }
}

function resetAllLayers() {
  state.layers.forEach((_, code) => setLayerState(code, 'idle'));
}

function applyMarks() {
  state.layers.forEach((_, code) => {
    const mark = state.marks.get(code);
    setLayerState(code, mark || 'idle');
  });
}

function clearMarks() {
  state.marks.clear();
  resetAllLayers();
}

function clearLabelTimers() {
  state.labelTimers.forEach(clearTimeout);
  state.labelTimers = [];
}

function flashWrongLabel(code) {
  revealLabel(code, 'wrong');
  const layer = state.layers.get(code);
  const t = setTimeout(() => {
    const tip = layer.getTooltip();
    const el = tip && tip.getElement();
    if (el) el.classList.remove('region-label--wrong');
    layer.setTooltipContent(nameOf(code));
    layer.closeTooltip();
  }, 1600);
  state.labelTimers.push(t);
}

function hoverRegion(code) {
  if (currentKindFor(code) === 'idle') state.layers.get(code).setStyle({ fillColor: COLORS.fillHover });
}

function unhoverRegion(code) {
  setLayerState(code, currentKindFor(code));
}

function currentKindFor(code) {
  if (state.mode === 'study') return state.selectedCode === code ? 'correct' : 'idle';
  if (state.mode === 'quiz') {
    if (state.revealed && code === state.queue[state.index]) return 'reveal';
    return state.marks.get(code) || 'idle';
  }
  return 'idle';
}

const LABEL_ICON = { wrong: '✕ ', correct: '✓ ', yellow: '✓ ', orange: '✓ ' };

function revealLabel(code, kind) {
  const layer = state.layers.get(code);
  if (!layer) return;
  layer.setTooltipContent((LABEL_ICON[kind] || '') + nameOf(code));
  layer.openTooltip();
  const tip = layer.getTooltip();
  const el = tip && tip.getElement();
  if (el) el.classList.add(`region-label--${kind}`);
}

function clearReveal() {
  state.layers.forEach((layer, code) => {
    const tip = layer.getTooltip();
    if (!tip) return;
    const el = tip.getElement();
    if (el) {
      el.classList.remove('region-label--correct', 'region-label--wrong', 'region-label--yellow', 'region-label--orange');
    }
    layer.setTooltipContent(nameOf(code));
    if (!state.labelsOn) layer.closeTooltip();
  });
}

function labelPriority(code) {
  return state.layers.get(code).feature.properties.area_km2 || 0;
}

function boxesOverlap(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function updateLabels() {
  if (!state.labelsOn) {
    state.layers.forEach((layer) => layer.closeTooltip());
    return;
  }
  const order = [...state.layers.keys()].sort((a, b) => {
    if (a === state.selectedCode) return -1;
    if (b === state.selectedCode) return 1;
    return labelPriority(b) - labelPriority(a);
  });
  const boxes = new Map();
  order.forEach((code) => {
    const layer = state.layers.get(code);
    layer.openTooltip();
    const tip = layer.getTooltip();
    const el = tip && tip.getElement();
    boxes.set(code, el ? el.getBoundingClientRect() : null);
  });

  const placed = [];
  const mapRect = map.getContainer().getBoundingClientRect();
  const margin = 4;
  order.forEach((code) => {
    const layer = state.layers.get(code);
    const r = boxes.get(code);
    if (
      !r ||
      r.width === 0 ||
      r.left < mapRect.left + margin ||
      r.right > mapRect.right - margin ||
      r.top < mapRect.top + margin ||
      r.bottom > mapRect.bottom - margin
    ) {
      layer.closeTooltip();
      return;
    }
    const box = { left: r.left - 3, top: r.top - 2, right: r.right + 3, bottom: r.bottom + 2 };
    if (placed.some((p) => boxesOverlap(p, box))) layer.closeTooltip();
    else placed.push(box);
  });
}

let labelRaf = null;
function scheduleLabels() {
  if (!state.labelsOn) return;
  if (labelRaf) cancelAnimationFrame(labelRaf);
  labelRaf = requestAnimationFrame(() => {
    labelRaf = null;
    updateLabels();
  });
}

function setLabels(on) {
  state.labelsOn = on;
  updateLabels();
}

function focusRegion(code) {
  const p = state.layers.get(code).feature.properties;
  if (!p || !p.center || !map) return;
  const target = L.latLng(p.center[1], p.center[0]);
  if (map.getBounds().pad(-0.12).contains(target)) return;
  map.flyTo(target, Math.max(map.getZoom(), 7), { duration: prefersReduced() ? 0 : 0.6 });
}

function wireRegionA11y(code, layer) {
  const path = layer._path;
  if (!path) return;
  path.setAttribute('role', 'button');
  path.setAttribute('tabindex', '-1');
  path.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      onRegionClick(code);
    }
  });
  path.addEventListener('focus', () => {
    if (state.mode === 'study' && state.selectedCode !== code) {
      layer.setStyle({ fillColor: COLORS.fillHover });
    }
  });
  path.addEventListener('blur', () => {
    if (state.mode !== 'study') return;
    if (state.selectedCode === code) setLayerState(code, 'correct');
    else setLayerState(code, 'idle');
  });
}

function updatePathAccessibility() {
  const study = state.mode === 'study';
  state.layers.forEach((layer, code) => {
    const path = layer._path;
    if (!path) return;
    path.setAttribute('tabindex', study ? '0' : '-1');
    if (study) path.setAttribute('aria-label', nameOf(code));
    else path.removeAttribute('aria-label');
  });
}

function initMap(data) {
  map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    minZoom: 5,
    maxZoom: 11,
    maxBoundsViscosity: 0.8,
  });

  L.control.zoom({ zoomInTitle: 'Przybliż', zoomOutTitle: 'Oddal' }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 140 }).addTo(map);
  L.control
    .attribution({ position: 'bottomright', prefix: false })
    .addTo(map)
    .addAttribution('Granice: Solon i in. 2018 (GDOŚ)');

  geojsonLayer = L.geoJSON(data, {
    style: baseStyle,
    onEachFeature: (feature, layer) => {
      const { code, name } = feature.properties;
      state.layers.set(code, layer);
      layer.bindTooltip(name, {
        permanent: true,
        direction: 'center',
        className: 'region-label',
        opacity: 1,
      });
      layer.on('add', () => wireRegionA11y(code, layer));
      layer.on('click', () => onRegionClick(code));
      layer.on('mouseover', () => hoverRegion(code));
      layer.on('mouseout', () => unhoverRegion(code));
    },
  }).addTo(map);

  geojsonLayer.eachLayer((l) => l.closeTooltip());

  const bounds = geojsonLayer.getBounds();
  map.fitBounds(bounds, { padding: [12, 12] });
  map.setMaxBounds(bounds.pad(0.35));
  map.on('zoomend moveend', scheduleLabels);
  setupSmallRegionMarkers();
  updatePathAccessibility();
}

const SMALL_REGION_KM2 = 500;

function setupSmallRegionMarkers() {
  map.createPane('markerPane2');
  map.getPane('markerPane2').style.zIndex = 450;
  state.layers.forEach((layer, code) => {
    const p = layer.feature && layer.feature.properties;
    if (!p || !p.center || (p.area_km2 || 0) >= SMALL_REGION_KM2) return;
    const latlng = [p.center[1], p.center[0]];
    L.circleMarker(latlng, {
      pane: 'markerPane2',
      radius: 3,
      className: 'region-dot',
      interactive: false,
    }).addTo(map);
    const hit = L.circleMarker(latlng, {
      pane: 'markerPane2',
      radius: 12,
      className: 'region-hitbox',
      fillColor: '#000',
      fillOpacity: 0,
      opacity: 0,
      weight: 0,
      interactive: true,
      bubblingMouseEvents: false,
    }).addTo(map);
    state.hitboxes.set(code, hit);
    hit.on('click', () => onRegionClick(code));
    hit.on('mouseover', () => {
      hoverRegion(code);
      hit.setStyle({ fillColor: COLORS.accent, fillOpacity: 0.18, opacity: 0.7, weight: 1, color: COLORS.accent });
      hit.bringToFront();
    });
    hit.on('mouseout', () => {
      unhoverRegion(code);
      hit.setStyle({ fillColor: '#000', fillOpacity: 0, opacity: 0, weight: 0 });
    });
  });
}

function populateAnswerSelect() {
  if (!dom.answerSelect) return;
  const items = [...state.layers.entries()]
    .map(([code, layer]) => ({ code, name: layer.feature.properties.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— wybierz region —';
  dom.answerSelect.replaceChildren(
    placeholder,
    ...items.map((o) => {
      const opt = document.createElement('option');
      opt.value = o.code;
      opt.textContent = o.name;
      return opt;
    })
  );
}

/* ------------------------------------------------------------------ */
/* Quiz logic                                                          */
/* ------------------------------------------------------------------ */

function startQuiz(codes) {
  clearTimer();
  clearLabelTimers();
  if (!dom.modal.classList.contains('is-hidden')) closeModal();
  state.labelsOn = false;
  state.layers.forEach((l) => l.closeTooltip());
  state.queue = shuffle(codes && codes.length ? codes : [...state.layers.keys()]);
  state.index = 0;
  state.correct = 0;
  state.mistakes = [];
  state.attempts = 0;
  state.revealed = false;
  state.wrongClicks = new Set();
  clearMarks();
  switchMode('quiz');
  askQuestion();
}

function askQuestion() {
  clearLabelTimers();
  state.answered = false;
  state.attempts = 0;
  state.revealed = false;
  state.wrongClicks = new Set();
  applyMarks();
  clearReveal();
  dom.promptBox.classList.remove('is-correct', 'is-wrong');
  setFeedback(null, '');
  flashPrompt();

  const code = state.queue[state.index];
  dom.promptName.textContent = nameOf(code);
  fitPromptName();

  const total = state.queue.length;
  const pct = Math.round((state.index / total) * 100);
  dom.progressText.textContent = `Pytanie ${state.index + 1} z ${total}`;
  dom.progressPct.textContent = `${pct}%`;
  dom.progressFill.style.width = `${pct}%`;
  updateStats();
}

function onRegionClick(code) {
  if (state.mode === 'study') {
    showInfo(code);
    return;
  }
  if (state.answered) return;
  if (state.marks.has(code)) return;
  const target = state.queue[state.index];

  if (code === target) {
    if (state.attempts === 0 && !state.revealed) handleFirstTry(target);
    else resolveAfterMistakes(target);
    return;
  }
  registerWrongClick(code);
}

function registerWrongClick(code) {
  if (state.wrongClicks.has(code)) return;
  state.wrongClicks.add(code);
  const target = state.queue[state.index];
  if (!state.mistakes.includes(target)) {
    state.mistakes.push(target);
    updateStats();
  }
  flashWrongLabel(code);

  if (state.revealed) return;
  state.attempts += 1;
  if (state.attempts >= 3) revealTarget(target);
}

function revealTarget(target) {
  state.revealed = true;
  setLayerState(target, 'reveal');
  focusRegion(target);
}

function handleFirstTry(code) {
  state.answered = true;
  state.correct += 1;
  state.marks.set(code, 'correct');
  setLayerState(code, 'correct');
  revealLabel(code, 'correct');
  dom.promptBox.classList.add('is-correct');
  setFeedback('correct', 'Dobrze!', '✓');
  updateStats();
  state.timer = setTimeout(advance, 800);
}

function resolveAfterMistakes(target) {
  state.answered = true;
  let kind;
  if (state.revealed) kind = 'wrong';
  else if (state.attempts <= 1) kind = 'yellow';
  else kind = 'orange';
  state.marks.set(target, kind);
  setLayerState(target, kind);
  revealLabel(target, kind);
  updateStats();
  state.timer = setTimeout(() => {
    clearReveal();
    advance();
  }, 1100);
}

function skipQuestion() {
  if (state.mode !== 'quiz' || state.answered || state.revealed) return;
  const target = state.queue[state.index];
  if (!state.mistakes.includes(target)) state.mistakes.push(target);
  revealTarget(target);
  updateStats();
}

function advance() {
  state.index += 1;
  applyMarks();
  if (state.index >= state.queue.length) {
    finish();
  } else {
    askQuestion();
  }
}

function finish() {
  clearReveal();
  const total = state.queue.length;
  const correct = state.correct;
  const pct = total ? Math.round((correct / total) * 100) : 0;

  dom.modalScore.textContent = `${correct} / ${total}`;
  const ringColor = pct >= 80 ? 'var(--correct)' : pct >= 50 ? 'var(--gold)' : 'var(--wrong)';
  dom.modalRing.style.setProperty('--pct', pct);
  dom.modalRing.style.setProperty('--ring-color', ringColor);
  dom.modalSub.textContent = `${pct}% poprawnych odpowiedzi`;

  const unique = [...new Set(state.mistakes)];
  if (unique.length) {
    dom.modalReview.classList.remove('is-hidden');
    dom.reviewList.replaceChildren(
      ...unique.map((c) => {
        const li = document.createElement('li');
        li.textContent = nameOf(c);
        return li;
      })
    );
  } else {
    dom.modalReview.classList.add('is-hidden');
    dom.reviewList.replaceChildren();
  }
  document.getElementById('btn-retry-wrong').disabled = unique.length === 0;

  dom.modalTitle.textContent = pct === 100 ? 'Bezbłędnie!' : 'Koniec rundy';
  dom.progressFill.style.width = '100%';
  dom.progressPct.textContent = '100%';

  const best = getBest();
  if (!best || pct > bestPct(best) || (pct === bestPct(best) && correct > best.correct)) {
    try {
      localStorage.setItem(
        'regiony-best',
        JSON.stringify({ correct, total, pct, date: new Date().toISOString().slice(0, 10) })
      );
    } catch (e) {}
  }
  updateStats();
  openModal();
}

/* ------------------------------------------------------------------ */
/* Study mode                                                          */
/* ------------------------------------------------------------------ */

function showInfo(code) {
  resetAllLayers();
  state.selectedCode = code;
  setLayerState(code, 'correct');
  const p = state.layers.get(code).feature.properties;
  dom.infoCard.innerHTML = `
    <h2>${p.name}</h2>
    <span class="code">${p.code}</span>
    <dl>
      <dt>Megaregion</dt><dd>${p.megaregion || '–'}</dd>
      <dt>Prowincja</dt><dd>${p.province || '–'}</dd>
      <dt>Podprowincja</dt><dd>${p.subprovince || '–'}</dd>
      <dt>Powierzchnia</dt><dd>${p.area_km2.toLocaleString('pl-PL')} km²</dd>
      <dt>Nazwa angielska</dt><dd>${p.name_en || '–'}</dd>
    </dl>`;
  focusRegion(code);
  dom.infoCard.scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', block: 'nearest' });
}

function switchMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.tab').forEach((t) => {
    const active = t.dataset.mode === mode;
    t.classList.toggle('is-active', active);
    t.setAttribute('aria-selected', active ? 'true' : 'false');
    t.tabIndex = active ? 0 : -1;
  });
  document.getElementById('view-quiz').classList.toggle('is-hidden', mode !== 'quiz');
  document.getElementById('view-study').classList.toggle('is-hidden', mode !== 'study');
  if (mode === 'study') {
    clearTimer();
    resetAllLayers();
    setLabels(document.getElementById('toggle-labels').checked);
  } else {
    state.selectedCode = null;
    setLabels(false);
  }
  updatePathAccessibility();
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

function openModal() {
  lastFocused = document.activeElement;
  dom.modal.classList.remove('is-hidden');
  document.getElementById('btn-again').focus();
}

function closeModal() {
  if (dom.modal.classList.contains('is-hidden')) return;
  dom.modal.classList.add('is-hidden');
  if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
}

function trapFocus(e) {
  if (e.key !== 'Tab') return;
  const focusables = [...dom.modal.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((el) => el.offsetParent !== null);
  if (focusables.length < 2) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('regiony-theme', theme);
  } catch (e) {}
  COLORS = readColors();
  if (map) {
    state.layers.forEach((_, code) => setLayerState(code, currentKindFor(code)));
    updateLabels();
  }
}

function selectTab(mode) {
  if (mode === state.mode) return;
  clearTimer();
  if (mode === 'quiz') startQuiz();
  else switchMode('study');
}

function bindUI() {
  const tabs = [...document.querySelectorAll('.tab')];
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab.dataset.mode));
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(i + dir + tabs.length) % tabs.length];
      next.focus();
      selectTab(next.dataset.mode);
    });
  });

  document.getElementById('btn-skip').addEventListener('click', skipQuestion);
  document.getElementById('btn-restart').addEventListener('click', () => startQuiz());
  document.getElementById('btn-start-quiz').addEventListener('click', () => startQuiz());
  document.getElementById('btn-again').addEventListener('click', () => startQuiz());
  document.getElementById('btn-retry-wrong').addEventListener('click', () => {
    const unique = [...new Set(state.mistakes)];
    if (unique.length) startQuiz(unique);
  });

  dom.answerSelect.addEventListener('change', (e) => {
    const code = e.target.value;
    e.target.value = '';
    if (code) onRegionClick(code);
  });

  document.getElementById('toggle-labels').addEventListener('change', (e) => setLabels(e.target.checked));
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  window.addEventListener('resize', fitPromptName);

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  dom.modal.addEventListener('click', (e) => {
    if (e.target === dom.modal) closeModal();
  });
  dom.modal.addEventListener('keydown', trapFocus);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dom.modal.classList.contains('is-hidden')) closeModal();
  });
}

async function init() {
  bindUI();
  updateStats();
  try {
    const data = window.__REGIONS__;
    if (!data || !data.features || !data.features.length) {
      throw new Error('Brak danych regionów (window.__REGIONS__).');
    }
    state.features = data.features;
    initMap(data);
    populateAnswerSelect();
    startQuiz();
  } catch (err) {
    console.error(err);
    dom.promptName.textContent = 'Błąd wczytywania danych';
    setFeedback('wrong', 'Nie udało się wczytać danych regionów (data/makroregiony.js). Sprawdź, czy pliki projektu są kompletne.', '✕');
  }
}

init();

window.__state = state;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

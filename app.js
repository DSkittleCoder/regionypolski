const DATA_URL = 'data/makroregiony.geojson';

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  return {
    fill: v('--map-fill'),
    fillHover: v('--map-hover'),
    correct: v('--map-correct'),
    wrong: v('--map-wrong'),
    stroke: v('--map-stroke'),
    strokeActive: v('--map-stroke-active'),
  };
}

let COLORS = readColors();

const state = {
  features: [],
  layers: new Map(),
  mode: 'quiz',
  queue: [],
  index: 0,
  correct: 0,
  mistakes: [],
  answered: false,
  labelsOn: false,
  selectedCode: null,
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
};

let map;
let geojsonLayer;
let labelRank = new Map();

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const nameOf = (code) => state.layers.get(code).feature.properties.name;

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

function updateStats() {
  const best = getBest();
  dom.statCorrect.textContent = state.correct;
  dom.statWrong.textContent = state.mistakes.length;
  dom.statBest.textContent = best ? best.correct : 'brak';
  dom.statBest.title = best ? `Rekord: ${best.correct} / ${best.total}` : 'Brak wyniku';
}

function setFeedback(kind, text, icon) {
  dom.feedback.classList.remove('is-correct', 'is-wrong');
  if (kind) dom.feedback.classList.add(kind === 'correct' ? 'is-correct' : 'is-wrong');
  dom.feedbackIcon.textContent = icon || '';
  dom.feedbackText.textContent = text || '';
}

function flashPrompt() {
  dom.promptBox.classList.remove('is-pop');
  void dom.promptBox.offsetWidth;
  dom.promptBox.classList.add('is-pop');
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
  if (kind === 'correct') {
    layer.setStyle({ fillColor: COLORS.correct, fillOpacity: 1, color: COLORS.strokeActive, weight: 2 });
    layer.bringToFront();
  } else if (kind === 'wrong') {
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

function revealLabel(code, kind) {
  const layer = state.layers.get(code);
  if (!layer) return;
  layer.openTooltip();
  const tip = layer.getTooltip();
  const el = tip && tip.getElement();
  if (el) el.classList.add(`region-label--${kind}`);
}

function clearReveal() {
  state.layers.forEach((layer) => {
    const tip = layer.getTooltip();
    const el = tip && tip.getElement();
    if (el) el.classList.remove('region-label--correct', 'region-label--wrong');
    if (!state.labelsOn) layer.closeTooltip();
  });
}

function computeLabelRanks() {
  const sorted = [...state.layers.keys()].sort(
    (a, b) => state.layers.get(b).feature.properties.area_km2 - state.layers.get(a).feature.properties.area_km2
  );
  labelRank = new Map();
  sorted.forEach((code, i) => labelRank.set(code, i));
}

function labelCap() {
  const z = map ? map.getZoom() : 7;
  if (z <= 6) return 12;
  if (z === 7) return 22;
  if (z === 8) return 36;
  return 99;
}

function updateLabels() {
  const cap = labelCap();
  state.layers.forEach((layer, code) => {
    const show = state.labelsOn && labelRank.get(code) < cap;
    if (show) layer.openTooltip();
    else layer.closeTooltip();
  });
}

function setLabels(on) {
  state.labelsOn = on;
  updateLabels();
}

function initMap(data) {
  map = L.map('map', {
    zoomControl: true,
    attributionControl: false,
    minZoom: 5,
    maxZoom: 11,
    maxBoundsViscosity: 0.8,
  });

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
      layer.on('click', () => onRegionClick(code));
      layer.on('mouseover', () => {
        if (state.mode === 'quiz') {
          if (state.answered || state.marks.has(code)) return;
        }
        layer.setStyle({ fillColor: COLORS.fillHover });
      });
      layer.on('mouseout', () => {
        if (state.mode === 'study') {
          if (state.selectedCode === code) setLayerState(code, 'correct');
          else setLayerState(code, 'idle');
        } else {
          if (state.answered) return;
          const mark = state.marks.get(code);
          setLayerState(code, mark || 'idle');
        }
      });
    },
  }).addTo(map);

  geojsonLayer.eachLayer((l) => l.closeTooltip());

  const bounds = geojsonLayer.getBounds();
  map.fitBounds(bounds, { padding: [12, 12] });
  map.setMaxBounds(bounds.pad(0.35));
  computeLabelRanks();
  map.on('zoomend', updateLabels);
}

/* ------------------------------------------------------------------ */
/* Quiz logic                                                          */
/* ------------------------------------------------------------------ */

function startQuiz(codes) {
  clearTimer();
  state.labelsOn = false;
  state.layers.forEach((l) => l.closeTooltip());
  state.queue = shuffle(codes && codes.length ? codes : [...state.layers.keys()]);
  state.index = 0;
  state.correct = 0;
  state.mistakes = [];
  clearMarks();
  dom.modal.classList.add('is-hidden');
  switchMode('quiz');
  askQuestion();
}

function askQuestion() {
  state.answered = false;
  applyMarks();
  clearReveal();
  dom.promptBox.classList.remove('is-correct', 'is-wrong');
  setFeedback(null, '');
  flashPrompt();

  const code = state.queue[state.index];
  dom.promptName.textContent = nameOf(code);

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
  state.answered = true;

  const target = state.queue[state.index];
  if (code === target) {
    handleCorrect(target);
  } else {
    handleWrong(target, code);
  }
}

function handleCorrect(code) {
  state.correct += 1;
  state.marks.set(code, 'correct');
  setLayerState(code, 'correct');
  dom.promptBox.classList.add('is-correct');
  setFeedback('correct', 'Dobrze!', '✓');
  updateStats();
  state.timer = setTimeout(advance, 750);
}

function handleWrong(target, clicked) {
  state.mistakes.push(target);
  state.marks.set(target, 'correct');
  setLayerState(clicked, 'wrong');
  setLayerState(target, 'correct');
  revealLabel(clicked, 'wrong');
  revealLabel(target, 'correct');
  dom.promptBox.classList.add('is-wrong');
  setFeedback('wrong', 'Pomyłka', '✕');
  updateStats();
  state.timer = setTimeout(() => {
    clearReveal();
    advance();
  }, 1800);
}

function skipQuestion() {
  if (state.mode !== 'quiz' || state.answered) return;
  state.answered = true;
  const target = state.queue[state.index];
  state.mistakes.push(target);
  state.marks.set(target, 'correct');
  setLayerState(target, 'correct');
  revealLabel(target, 'correct');
  dom.promptBox.classList.add('is-wrong');
  setFeedback('wrong', 'Prawidłowa odpowiedź na mapie', '✕');
  updateStats();
  state.timer = setTimeout(() => {
    clearReveal();
    advance();
  }, 1700);
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
    dom.reviewList.innerHTML = unique.map((c) => `<li>${nameOf(c)}</li>`).join('');
  } else {
    dom.modalReview.classList.add('is-hidden');
  }
  document.getElementById('btn-retry-wrong').disabled = unique.length === 0;

  dom.modalTitle.textContent = pct === 100 ? 'Bezbłędnie!' : 'Koniec rundy';
  dom.modal.classList.remove('is-hidden');
  dom.progressFill.style.width = '100%';
  dom.progressPct.textContent = '100%';

  const best = getBest();
  if (!best || correct > best.correct) {
    localStorage.setItem('regiony-best', JSON.stringify({ correct, total }));
  }
  updateStats();
}

function renderBest() {
  updateStats();
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
      <dt>Podprowincja</dt><dd>${p.subprovince || '–'}</dd>
      <dt>Prowincja</dt><dd>${p.province || '–'}</dd>
      <dt>Megaregion</dt><dd>${p.megaregion || '–'}</dd>
      <dt>Powierzchnia</dt><dd>${p.area_km2.toLocaleString('pl-PL')} km²</dd>
      <dt>Nazwa angielska</dt><dd>${p.name_en || '–'}</dd>
    </dl>`;
}

function switchMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.mode === mode));
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
    state.layers.forEach((_, code) => setLayerState(code, state.marks.get(code) || 'idle'));
    if (state.mode === 'study' && state.selectedCode) setLayerState(state.selectedCode, 'correct');
    updateLabels();
  }
}

function bindUI() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.mode;
      if (mode === state.mode) return;
      clearTimer();
      if (mode === 'quiz') startQuiz();
      else switchMode('study');
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
  document.getElementById('toggle-labels').addEventListener('change', (e) => setLabels(e.target.checked));
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
}

async function init() {
  bindUI();
  renderBest();
  try {
    let data = window.__REGIONS__;
    if (!data) {
      const res = await fetch(DATA_URL);
      data = await res.json();
    }
    state.features = data.features;
    initMap(data);
    startQuiz();
  } catch (err) {
    console.error(err);
    dom.promptName.textContent = 'Błąd wczytywania danych';
    setFeedback('wrong', 'Nie udało się wczytać danych regionów (data/makroregiony.js). Sprawdź, czy pliki projektu są kompletne.', '✕');
  }
}

init();

window.__state = state;

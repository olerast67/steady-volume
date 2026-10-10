'use strict';

const api = globalThis.browser ?? globalThis.chrome;
const { CUSTOM, CUSTOM_FIELDS, presetFor } = LevelerEngine;
const DEFAULTS = { enabled: true, volume: 100, leveling: 2, dialog: false, custom: {}, disabledSites: [] };
const HINTS = ['hintOff', 'hintLight', 'hintAuto', 'hintNight', 'hintCustom'];
const BLOCK_MESSAGES = { drm: 'statusDrm', cors: 'statusCors', stream: 'statusStream', busy: 'statusBusy', lost: 'statusLost' };
const FIELD_UNITS = { target: 'LUFS', maxBoost: 'dB', maxCut: 'dB', release: 's', threshold: 'dB', ratio: ':1', ceiling: 'dB' };
const t = (key, subs) => api.i18n.getMessage(key, subs);
const $ = (id) => document.getElementById(id);
const num = new Intl.NumberFormat(api.i18n.getUILanguage(), { maximumFractionDigits: 1 });

let settings = { ...DEFAULTS };
let tab = null;
let host = null;
let canCapture = false;  // Chromium: whole-tab capture is available
let captureOn = false;
let autoCaptureTried = false;
let captureError = null;
// Reasons an element can't be connected directly; whole-tab capture handles them instead.
const CAPTURE_FOR = new Set(['drm', 'cors', 'busy', 'lost']);

for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
document.documentElement.lang = api.i18n.getUILanguage();

// Sliders of the fine-tuning panel, built from the limits the engine accepts.
for (const [key, [min, max, step]] of Object.entries(CUSTOM_FIELDS)) {
  const row = document.createElement('label');
  row.className = 'field';
  const head = document.createElement('span');
  head.className = 'row';
  const name = document.createElement('span');
  name.textContent = t('field_' + key);
  head.append(name, document.createElement('output'));
  const input = Object.assign(document.createElement('input'), { type: 'range', min, max, step, id: 'f_' + key });
  input.addEventListener('input', (e) => onField(key, Number(e.target.value)));
  row.append(head, input);
  $('fields').append(row);
}

const formatField = (key, v) => {
  const unit = FIELD_UNITS[key];
  if (unit === ':1') return num.format(v) + ':1';
  // maxCut is stored as a positive amount but shown as the reduction it is
  const shown = key === 'maxCut' ? -v : v;
  const sign = shown > 0 && key !== 'release' ? '+' : shown < 0 ? '−' : '';
  return sign + num.format(Math.abs(shown)) + ' ' + t('unit_' + unit);
};

// Values the sliders show: the current mode's, or the Auto preset's when leveling is off.
function shownPreset() {
  return presetFor(settings.leveling === 0 ? 2 : settings.leveling, settings.custom);
}

function render() {
  $('enabled').checked = settings.enabled;
  $('controls').classList.toggle('off', !settings.enabled);
  $('volume').value = settings.volume;
  $('volumeOut').textContent = settings.volume + '%';
  for (const b of $('leveling').querySelectorAll('button')) {
    b.setAttribute('aria-checked', String(Number(b.dataset.value) === settings.leveling));
  }
  $('customBadge').hidden = settings.leveling !== CUSTOM;
  $('levelHint').textContent = t(HINTS[settings.leveling] ?? 'hintAuto');
  const p = shownPreset();
  for (const key of Object.keys(CUSTOM_FIELDS)) {
    $('f_' + key).value = p[key];
    $('f_' + key).closest('.field').querySelector('output').textContent = formatField(key, p[key]);
  }
  $('dialog').checked = settings.dialog;
  $('site').checked = !!host && !settings.disabledSites.includes(host);
  $('site').disabled = !host;
  $('host').textContent = host || t('siteUnknown');
}

function save(patch) {
  Object.assign(settings, patch);
  render();
  return api.storage.sync.set(patch);
}

// storage.sync allows about two writes per second, so sliders write once they settle.
const pending = {};
let writeTimer = null;
function saveSoon(patch) {
  Object.assign(settings, patch);
  Object.assign(pending, patch);
  render();
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    api.storage.sync.set({ ...pending });
    for (const k of Object.keys(pending)) delete pending[k];
  }, 200);
}

function onField(key, value) {
  const p = shownPreset();
  const custom = {};
  for (const k of Object.keys(CUSTOM_FIELDS)) custom[k] = p[k];
  custom[key] = value;
  saveSoon({ leveling: CUSTOM, custom });
}

$('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));
$('dialog').addEventListener('change', (e) => save({ dialog: e.target.checked }));
$('site').addEventListener('change', (e) => {
  const others = settings.disabledSites.filter((h) => h !== host);
  save({ disabledSites: e.target.checked ? others : [...others, host] });
  if (!e.target.checked && captureOn) toggleCapture();
});

async function toggleCapture() {
  captureError = null;
  const r = await api.runtime.sendMessage({ type: captureOn ? 'stopCapture' : 'startCapture', tabId: tab.id }).catch((e) => ({ ok: false, error: e.message }));
  if (r && r.ok === false) captureError = r.error;
  poll();
}
$('capture').addEventListener('click', toggleCapture);

function showCaptureButton(show) {
  $('capture').hidden = !(canCapture && show);
  $('capture').textContent = t(captureOn ? 'captureStop' : 'captureStart');
}
$('volume').addEventListener('input', (e) => saveSoon({ volume: Number(e.target.value) }));
$('reset').addEventListener('click', () => save({ leveling: 2, custom: {}, volume: 100, dialog: false }));

$('leveling').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) save({ leveling: Number(b.dataset.value) });
});
$('leveling').addEventListener('keydown', (e) => {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!step) return;
  e.preventDefault();
  const current = settings.leveling === CUSTOM ? 2 : settings.leveling;
  const next = (current + step + 4) % 4;
  save({ leveling: next });
  $('leveling').querySelector(`[data-value="${next}"]`).focus();
});

function setStatus(text, warn = false) {
  $('status').textContent = text;
  $('status').classList.toggle('warn', warn);
}

function showMeter(gainDb) {
  const meter = $('meter');
  if (gainDb === null) { meter.hidden = true; return; }
  meter.hidden = false;
  const pos = Math.max(-20, Math.min(20, gainDb)) / 40 * 100; // percent of the bar from centre
  const bar = $('meterBar');
  bar.style.left = (pos < 0 ? 50 + pos : 50) + '%';
  bar.style.width = Math.max(1, Math.abs(pos)) + '%';
}

async function poll() {
  showCaptureButton(false);
  if (!settings.enabled) { showMeter(null); setStatus(t('statusOff')); return; }
  if (host && settings.disabledSites.includes(host)) { showMeter(null); setStatus(t('statusSiteOff')); return; }

  if (canCapture) {
    const c = await api.runtime.sendMessage({ type: 'captureStatus', tabId: tab.id }).catch(() => null);
    captureOn = !!c?.on;
    if (captureOn) {
      const loud = Number.isFinite(c.loudness) ? Math.round(c.loudness) : '…';
      const gain = (c.gainDb >= 0 ? '+' : '') + (c.gainDb ?? 0).toFixed(0);
      showMeter(c.gainDb ?? 0);
      setStatus(t('statusCaptured', [String(loud), gain]));
      showCaptureButton(true);
      return;
    }
  }
  if (captureError) {
    showMeter(null);
    setStatus(t('statusCaptureFailed', [captureError]), true);
    showCaptureButton(true);
    return;
  }

  let s = null;
  try {
    s = await api.tabs.sendMessage(tab.id, { type: 'status' });
  } catch {
    // no content script here: browser pages, extension stores, or a tab opened before install
    if (!host) { showMeter(null); setStatus(t('statusUnsupported')); return; }
  }
  if (!s) {
    showMeter(null);
    setStatus(t(canCapture && host ? 'statusNoneCapture' : 'statusNone'));
    showCaptureButton(!!host);
    return;
  }
  if (!host && s.host) { host = s.host; render(); } // tab URL can be hidden from the popup, the page script knows it
  const lastBlock = s.blocked[s.blocked.length - 1];
  if (s.playing) {
    const loud = Number.isFinite(s.loudness) ? Math.round(s.loudness) : '…';
    const gain = (s.gainDb >= 0 ? '+' : '') + s.gainDb.toFixed(0);
    let text = t('statusPlaying', [String(loud), gain]);
    if (s.limiter < -1) text += ', ' + t('limiterActive', [s.limiter.toFixed(0)]);
    showMeter(s.gainDb);
    setStatus(text);
  } else if (s.waiting) {
    showMeter(null);
    setStatus(t('statusWaiting'), true);
  } else if (lastBlock) {
    showMeter(null);
    // Opening the popup is the user action tab capture needs, so start it right away for videos
    // that can't be connected directly (DRM, servers without CORS, players with their own Web Audio).
    if (canCapture && CAPTURE_FOR.has(lastBlock) && !autoCaptureTried) {
      autoCaptureTried = true;
      setStatus(t('statusCaptureHint'));
      toggleCapture();
      return;
    }
    setStatus(t(BLOCK_MESSAGES[lastBlock]), true);
    showCaptureButton(CAPTURE_FOR.has(lastBlock));
  } else {
    showMeter(null);
    setStatus(t('statusPaused'));
  }
}

(async () => {
  // popup.html?tab=<id> shows the status of another tab (used for screenshots, scripts/screenshots.mjs)
  const tabParam = Number(new URLSearchParams(location.search).get('tab'));
  [tab] = tabParam ? [await api.tabs.get(tabParam)] : await api.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab.url);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'file:') host = url.hostname || 'file';
  } catch {}
  settings = { ...DEFAULTS, ...(await api.storage.sync.get(DEFAULTS)) };
  canCapture = !!(await api.runtime.sendMessage({ type: 'capabilities' }).catch(() => null))?.capture;
  render();
  poll();
  setInterval(poll, 500);
})();

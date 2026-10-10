'use strict';

const api = globalThis.browser ?? globalThis.chrome;
const DEFAULTS = { enabled: true, volume: 100, leveling: 2, dialog: false, disabledSites: [] };
const HINTS = ['hintOff', 'hintLight', 'hintMedium', 'hintStrong'];
const BLOCK_MESSAGES = { drm: 'statusDrm', cors: 'statusCors', stream: 'statusStream', busy: 'statusBusy' };
const t = (key, subs) => api.i18n.getMessage(key, subs);
const $ = (id) => document.getElementById(id);

let settings = { ...DEFAULTS };
let tab = null;
let host = null;

for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
document.documentElement.lang = api.i18n.getUILanguage();

function render() {
  $('enabled').checked = settings.enabled;
  $('controls').classList.toggle('off', !settings.enabled);
  $('volume').value = settings.volume;
  $('volumeOut').textContent = settings.volume + '%';
  for (const b of $('leveling').querySelectorAll('button')) {
    b.setAttribute('aria-checked', String(Number(b.dataset.value) === settings.leveling));
  }
  $('levelHint').textContent = t(HINTS[settings.leveling]);
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

$('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));
$('dialog').addEventListener('change', (e) => save({ dialog: e.target.checked }));
$('site').addEventListener('change', (e) => {
  const others = settings.disabledSites.filter((h) => h !== host);
  save({ disabledSites: e.target.checked ? others : [...others, host] });
});

// storage.sync allows ~2 writes per second sustained, so the slider writes once it settles.
let volumeTimer = null;
$('volume').addEventListener('input', (e) => {
  settings.volume = Number(e.target.value);
  $('volumeOut').textContent = settings.volume + '%';
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => api.storage.sync.set({ volume: settings.volume }), 150);
});

$('leveling').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) save({ leveling: Number(b.dataset.value) });
});
$('leveling').addEventListener('keydown', (e) => {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!step) return;
  e.preventDefault();
  const next = (settings.leveling + step + 4) % 4;
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
  if (!settings.enabled) { showMeter(null); setStatus(t('statusOff')); return; }
  if (host && settings.disabledSites.includes(host)) { showMeter(null); setStatus(t('statusSiteOff')); return; }
  let s = null;
  try {
    s = await api.tabs.sendMessage(tab.id, { type: 'status' });
  } catch {
    // no content script here: browser pages, extension stores, or a tab opened before install
    if (!host) { showMeter(null); setStatus(t('statusUnsupported')); return; }
  }
  if (!s) { showMeter(null); setStatus(t('statusNone')); return; }
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
  } else if (s.blocked.length) {
    showMeter(null);
    setStatus(t(BLOCK_MESSAGES[s.blocked[s.blocked.length - 1]]), true);
  } else {
    showMeter(null);
    setStatus(t('statusPaused'));
  }
}

(async () => {
  [tab] = await api.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab.url);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'file:') host = url.hostname || 'file';
  } catch {}
  settings = { ...DEFAULTS, ...(await api.storage.sync.get(DEFAULTS)) };
  render();
  poll();
  setInterval(poll, 500);
})();

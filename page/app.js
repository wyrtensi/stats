// Wiring: load the period file, render, keep period/language/theme/site in sync.
import { T, pickLang } from './i18n.js';
import { overview, details, collected, updated } from './render.js';

const $ = (id) => document.getElementById(id);
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

const state = { days: Number(store.get('days')) || 30, lang: pickLang(navigator.language, store.get('lang')), data: null };
const theme = store.get('theme');
if (theme) document.documentElement.dataset.theme = theme;

async function load() {
  try {
    const r = await fetch(`/data/${state.days}.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    state.data = await r.json();
    $('error').hidden = true;
  } catch (err) {
    state.data = null;
    $('error').textContent = state.lang === 'ru' ? 'Не удалось загрузить данные.' : 'Could not load the data.';
    $('error').hidden = false;
    console.error('stats data', err);
  }
  render();
}

function render() {
  const t = T[state.lang];
  document.documentElement.lang = state.lang;
  $('lead').textContent = t.lead;
  $('lang').textContent = t.lang;
  $('theme').setAttribute('aria-label', t.theme);
  for (const b of $('period').querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.days) === state.days));
  $('collected').innerHTML = collected(state.lang);
  if (!state.data) { $('overview').innerHTML = ''; $('details').hidden = true; return; }
  $('overview').innerHTML = overview(state.data, state.lang);
  const host = decodeURIComponent(location.hash.slice(1));
  const site = state.data.sites.find((s) => s.host === host);
  for (const c of $('overview').querySelectorAll('.card')) c.setAttribute('aria-current', String(c.dataset.site === host));
  $('details').hidden = !site;
  $('details').innerHTML = site ? details(site, state.data.app, state.lang) : '';
  for (const bar of document.querySelectorAll('.bar[data-w]')) bar.style.setProperty('--w', `${bar.dataset.w}%`);
  $('updated').innerHTML = updated(state.data.generated, new Date(), state.lang);
}

$('period').addEventListener('click', (e) => {
  const days = Number(e.target.dataset?.days);
  if (!days) return;
  state.days = days; store.set('days', String(days)); load();
});
$('lang').addEventListener('click', () => { state.lang = state.lang === 'ru' ? 'en' : 'ru'; store.set('lang', state.lang); render(); });
$('theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  store.set('theme', document.documentElement.dataset.theme);
});
addEventListener('hashchange', render);
load();

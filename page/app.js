// Wiring: load the period file, render, keep period/language/theme/site in sync.
import { T, pickLang } from './i18n.js';
import { overview, details, collected, updated, summary, daysText, weekdayLabel, peopleText } from './render.js';

const $ = (id) => document.getElementById(id);
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

const PERIODS = [7, 30, 90];
const savedDays = Number(store.get('days'));
const state = { days: PERIODS.includes(savedDays) ? savedDays : 30, lang: pickLang(navigator.language, store.get('lang')),
  data: null, error: false };
const theme = store.get('theme');
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;

let loading = 0;
async function load() {
  const days = state.days;
  const ticket = ++loading;
  let data = null;
  try {
    const r = await fetch(`/data/${days}.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    data = await r.json();
  } catch (err) {
    if (ticket === loading) console.error('stats data', err);
  }
  // A newer request (or a different period) has been asked for since: drop this answer.
  if (ticket !== loading || days !== state.days) return;
  state.data = data;
  state.error = !data;
  render();
}

function currentHost() {
  try { return decodeURIComponent(location.hash.slice(1)); } catch { return ''; }
}

function render() {
  const t = T[state.lang];
  hideTip();
  document.documentElement.lang = state.lang;
  $('lead').textContent = t.lead;
  $('lang').textContent = t.lang;
  $('theme').setAttribute('aria-label', t.theme);
  $('theme').title = t.theme;
  $('github').setAttribute('aria-label', t.github);
  $('github').title = t.github;
  $('period').setAttribute('aria-label', t.periodLabel);
  for (const b of $('period').querySelectorAll('button')) {
    const days = Number(b.dataset.days);
    b.textContent = daysText(days, state.lang);
    b.setAttribute('aria-pressed', String(days === state.days));
  }
  $('error').textContent = t.loadError;
  $('error').hidden = !state.error;
  $('collected').innerHTML = collected(state.lang);
  if (!state.data) {
    $('summary').hidden = true; $('overview').innerHTML = ''; $('details').hidden = true; $('updated').textContent = '';
    return;
  }
  $('summary').textContent = summary(state.data, state.lang);
  $('summary').hidden = false;
  $('overview').innerHTML = overview(state.data, state.lang);
  const host = currentHost();
  const site = state.data.sites.find((s) => s.host === host);
  for (const c of $('overview').querySelectorAll('.card')) c.setAttribute('aria-current', String(c.dataset.site === host));
  $('details').hidden = !site;
  $('details').innerHTML = site ? details(site, state.data.app, state.lang) : '';
  for (const bar of document.querySelectorAll('.bar[data-w]')) bar.style.setProperty('--w', `${bar.dataset.w}%`);
  $('updated').innerHTML = updated(state.data.generated, new Date(), state.lang);
}

// Tooltip for the details chart: one #tip card, placed through CSS custom
// properties above the hovered, focused or tapped bar.
const tip = $('tip');
let tipBar = null;
function showTip(bar) {
  if (tipBar === bar) return;
  hideTip();
  tipBar = bar;
  bar.classList.add('on');
  tip.querySelector('.tip-when').textContent = weekdayLabel(bar.dataset.day, state.lang);
  tip.querySelector('.tip-n').textContent = peopleText(Number(bar.dataset.n), state.lang);
  tip.hidden = false;
  const r = (bar.querySelector('.b, .stub') ?? bar).getBoundingClientRect();
  const half = tip.offsetWidth / 2, gap = 8;
  const x = Math.min(Math.max(r.left + r.width / 2, half + gap), innerWidth - half - gap);
  const below = r.top - tip.offsetHeight - 2 * gap < 0;
  tip.classList.toggle('below', below);
  tip.style.setProperty('--x', `${x.toFixed(1)}px`);
  tip.style.setProperty('--y', `${(below ? r.bottom : r.top).toFixed(1)}px`);
}
function hideTip() {
  tipBar?.classList.remove('on');
  tipBar = null;
  tip.hidden = true;
}
const barOf = (e) => e.target.closest?.('[data-day]') ?? null;
document.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse' && barOf(e)) showTip(barOf(e)); });
document.addEventListener('pointerout', (e) => {
  if (e.pointerType === 'mouse' && barOf(e) && !barOf(e).contains(e.relatedTarget)) hideTip();
});
// Touch and pen: a tap on a bar shows it, a tap anywhere else hides it.
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  if (barOf(e)) showTip(barOf(e)); else hideTip();
});
document.addEventListener('focusin', (e) => { if (barOf(e)) showTip(barOf(e)); });
document.addEventListener('focusout', (e) => { if (barOf(e) === tipBar) hideTip(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });
addEventListener('scroll', hideTip, { passive: true });
addEventListener('resize', hideTip);

$('period').addEventListener('click', (e) => {
  const days = Number(e.target.closest?.('button[data-days]')?.dataset.days);
  if (!PERIODS.includes(days) || (days === state.days && !state.error)) return;
  state.days = days; store.set('days', String(days));
  render();
  load();
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
render();
load();

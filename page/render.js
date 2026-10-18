// Pure rendering: data in, HTML strings out. No DOM access, so it is testable in Node.
import { T, plural } from './i18n.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const fmt = (n, lang) => new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US').format(n);

// Each site's colour is a data-color attribute that CSS maps to --site-1..3;
// `about` is the i18n key of the one-line description; `icon` is a same-origin file.
export const SITE_INFO = {
  'rusinternet.com': { color: 'site-1', about: 'aboutRusinternet', icon: '/icons/rusinternet.svg' },
  'wystore.ru': { color: 'site-2', about: 'aboutWystore', icon: '/icons/wystore.png' },
  'washguide.ru': { color: 'site-3', about: 'aboutWashguide', icon: '/icons/washguide.svg' }
};

const info = (host) => (Object.hasOwn(SITE_INFO, host) ? SITE_INFO[host] : null);
const colorAttr = (host) => (info(host) ? ` data-color="${info(host).color}"` : '');
const about = (host, lang) => (info(host) ? T[lang][info(host).about] : '');
const iconTag = (host, size, extra = '') => (info(host)
  ? `<img class="site-icon${extra}" src="${esc(info(host).icon)}" alt="" width="${size}" height="${size}">` : '');

const counted = (n, lang, key) => {
  const t = T[lang];
  return `${fmt(n, lang)} ${plural(n, t[key + 'One'], t[key + 'Few'], t[key + 'Many'], lang)}`;
};
export const peopleText = (n, lang) => counted(n, lang, 'people');
export const daysText = (n, lang) => counted(n, lang, 'day');

// Share of a total: "75%", "<1%" for a non-zero share under 1%, "0%" for zero.
export function pct(n, total) {
  if (!n || !total) return '0%';
  const p = (n / total) * 100;
  return p < 1 ? '<1%' : `${Math.round(p)}%`;
}

const locale = (lang) => (lang === 'ru' ? 'ru-RU' : 'en-GB');
const dateOf = (day) => {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(String(day)) ? new Date(`${day}T00:00:00Z`) : null;
  return at && !Number.isNaN(at.getTime()) ? at : null;
};

// "18 окт" / "18 Oct": the UTC date without the abbreviation dot. Anything
// that is not a YYYY-MM-DD date comes back as is (callers escape it).
export function dayLabel(day, lang) {
  const at = dateOf(day);
  if (!at) return String(day);
  const parts = new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short', timeZone: 'UTC' }).formatToParts(at);
  const part = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')} ${part('month').replace(/\.$/, '')}`;
}

// "Сб, 18 окт" / "Sat, 18 Oct": the first line of a bar's title and tooltip.
export function weekdayLabel(day, lang) {
  const at = dateOf(day);
  if (!at) return String(day);
  const wd = new Intl.DateTimeFormat(locale(lang), { weekday: 'short', timeZone: 'UTC' }).format(at).replace(/\.$/, '');
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${dayLabel(day, lang)}`;
}

// Smallest of 1, 2, 5 x 10^k that is >= max; the chart's top grid line.
export function niceMax(max) {
  if (!(max > 0)) return 1;
  for (let k = 10 ** Math.floor(Math.log10(max)); ; k *= 10) {
    for (const m of [1, 2, 5]) if (m * k >= max) return m * k;
  }
}

// Plain text, not HTML: app.js sets it with textContent.
export function summary(data, lang) {
  const t = T[lang];
  const sites = data.sites ?? [];
  const total = sites.reduce((sum, s) => sum + (s.visits || 0), 0);
  const days = daysText(data.period?.days ?? 0, lang);
  if (!total) return t.summaryNone.replace('{days}', () => days);
  const busiest = sites.reduce((a, s) => ((s.visits || 0) > (a.visits || 0) ? s : a));
  return t.summary.replace('{days}', () => days).replace('{people}', () => peopleText(total, lang))
    .replace('{site}', () => busiest.host);
}

const svgId = (prefix, host) => `${prefix}-${String(host).replace(/[^a-z0-9]/gi, '-')}`;

// Card chart: a line over a soft gradient area, with a dot on the last day.
// A single day or an all-zero series is a flat line at the bottom, never nothing.
export function sparkline(daily, host) {
  const W = 240, H = 56, P = 4, bottom = H - P;
  const id = svgId('g', host);
  const max = Math.max(0, ...daily.map((d) => d.visits || 0));
  const flat = daily.length < 2 || !max;
  const step = flat ? 0 : (W - 2 * P) / (daily.length - 1);
  const pts = flat ? [[P, bottom], [W - P, bottom]]
    : daily.map((d, i) => [P + i * step, bottom - ((d.visits || 0) / max) * (bottom - P)]);
  const xy = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`;
  const line = `M${pts.map(xy).join('L')}`;
  const area = `${line}L${xy([W - P, bottom])}L${xy([P, bottom])}Z`;
  const [lx, ly] = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">`
    + `<defs><linearGradient id="${esc(id)}" x1="0" y1="0" x2="0" y2="1">`
    + '<stop offset="0" stop-opacity="0.25"/><stop offset="1" stop-opacity="0"/></linearGradient></defs>'
    + `<path class="area" d="${area}" fill="url(#${esc(id)})"/><path class="line" d="${line}"/>`
    + `<circle class="dot" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3"/></svg>`;
}

// The line under the details chart: average per day and the busiest day
// (the latest one when several tie).
export function chartFacts(daily, lang) {
  const t = T[lang];
  const total = daily.reduce((sum, d) => sum + (d.visits || 0), 0);
  if (!total) return t.noVisitsPeriod;
  const avg = total / daily.length;
  const shown = avg >= 10 ? Math.round(avg) : Math.round(avg * 10) / 10 || Math.round(avg * 100) / 100;
  const peak = daily.reduce((a, d) => ((d.visits || 0) >= (a.visits || 0) ? d : a));
  return t.avgLine.replace('{avg}', () => fmt(shown, lang))
    .replace('{people}', () => plural(shown, t.peopleOne, t.peopleFew, t.peopleMany, lang))
    .replace('{peak}', () => fmt(peak.visits, lang)).replace('{date}', () => dayLabel(peak.day, lang));
}

// Every day, every 7th or every 14th, counted back from the last day.
const labelStep = (n) => (n <= 7 ? 1 : n <= 30 ? 7 : 14);

// Details chart: one bar per day over three grid lines (0, half, nice max),
// thinned-out dates below. Fixed viewBox; CSS scales it to the full width.
// Bars reach past the baseline by their corner radius and are clipped there,
// so only the top corners show rounded.
export function bars(daily, lang, host) {
  if (!daily.length) return '';
  const t = T[lang];
  const L = 34, TOP = 12, PW = 680, PH = 170, base = TOP + PH, R = 3;
  const top = niceMax(Math.max(0, ...daily.map((d) => d.visits || 0)));
  const clip = svgId('c', host);
  const slot = PW / daily.length, bw = slot * 0.7;
  const grid = [0, top / 2, top].map((v) => {
    const y = (base - (v / top) * PH).toFixed(1);
    return `<line class="grid" x1="${L}" x2="${L + PW}" y1="${y}" y2="${y}"/>`
      + `<text class="ylabel" x="${L - 6}" y="${y}" dy="0.32em">${fmt(v, lang)}</text>`;
  }).join('');
  const step = labelStep(daily.length);
  const cols = [], labels = [];
  daily.forEach((d, i) => {
    const n = d.visits || 0;
    const x = L + i * slot, cx = (x + slot / 2).toFixed(1);
    const title = `${weekdayLabel(d.day, lang)}: ${peopleText(n, lang)}`;
    const h = (n / top) * PH;
    const mark = n
      ? `<rect class="b" x="${(x + slot * 0.15).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${(h + R).toFixed(1)}" rx="${Math.min(R, bw / 2).toFixed(1)}"/>`
      : `<rect class="stub" x="${(x + slot * 0.15).toFixed(1)}" y="${base - 2}" width="${bw.toFixed(1)}" height="2"/>`;
    cols.push(`<g data-day="${esc(d.day)}" data-n="${n}" tabindex="0"><title>${esc(title)}</title>`
      + `<rect class="hit" x="${x.toFixed(1)}" y="${TOP}" width="${slot.toFixed(1)}" height="${PH}"/>${mark}</g>`);
    if ((daily.length - 1 - i) % step === 0) labels.push(`<text class="xlabel" x="${cx}" y="${base + 20}">${esc(dayLabel(d.day, lang))}</text>`);
  });
  return `<figure class="chart" aria-label="${esc(t.chartLabel)}">`
    + `<svg class="bars" viewBox="0 0 720 220"><defs><clipPath id="${esc(clip)}"><rect x="${L}" y="0" width="${PW}" height="${base}"/></clipPath></defs>`
    + `${grid}<g class="cols" clip-path="url(#${esc(clip)})">${cols.join('')}</g>${labels.join('')}</svg>`
    + `<figcaption>${esc(chartFacts(daily, lang))}</figcaption></figure>`;
}

// One list: heading, plain hint, rows with count and share of `total`.
// GoatCounter names: "" is a direct visit for referrers and unknown elsewhere;
// "unknown" and "(unknown)" are unknown; "other" is the exporter's remainder.
// Entries that read as unknown are merged into one before ranking and shares.
function list({ title, hint, items, total, lang, label = (x) => x.name, empty = 'unknown' }) {
  if (!items.length) return '';
  const t = T[lang];
  const isUnknown = (n) => n === 'unknown' || n === '(unknown)' || (n === '' && empty === 'unknown');
  const merged = [];
  let unknown = null;
  for (const x of items) {
    if (!isUnknown(x.name)) merged.push(x);
    else if (unknown) unknown.visits += x.visits;
    else merged.push(unknown = { name: 'unknown', visits: x.visits });
  }
  if (unknown) {
    const rest = merged.filter((x) => x.name !== 'other');
    items = [...rest.sort((a, b) => b.visits - a.visits), ...merged.filter((x) => x.name === 'other')];
  }
  const max = Math.max(1, ...items.map((x) => x.visits));
  const rows = items.map((x) => {
    const name = x.name === 'other' ? t.other
      : x.name === '' ? t[empty]
        : x.name === 'unknown' || x.name === '(unknown)' ? t.unknown
          : label(x);
    return `<li><span class="bar" data-w="${Math.round((x.visits / max) * 100)}"></span><span class="name">${esc(name)}</span>`
      + `<span class="num">${fmt(x.visits, lang)} · ${pct(x.visits, total)}</span></li>`;
  }).join('');
  return `<section class="list"><h3>${title}</h3>${hint ? `<p class="hint">${hint}</p>` : ''}<ol>${rows}</ol></section>`;
}

const botsText = (n, lang) => {
  const t = T[lang];
  return plural(n, t.botsOne, t.botsFew, t.botsMany, lang).replace('{n}', () => fmt(n, lang));
};

export function overview(data, lang) {
  const t = T[lang];
  return data.sites.map((s) => {
    const bots = s.bots?.requests ?? 0;
    const desc = about(s.host, lang);
    return `<a class="card" href="#${esc(s.host)}" data-site="${esc(s.host)}"${colorAttr(s.host)}>
  <span class="host">${iconTag(s.host, 28)}${esc(s.host)}</span>
  ${desc ? `<span class="about">${desc}</span>` : ''}
  <span class="count"><span class="big">${fmt(s.visits, lang)}</span> <span class="unit">${plural(s.visits, t.peopleOne, t.peopleFew, t.peopleMany, lang)}</span></span>
  ${bots ? `<span class="bots">${botsText(bots, lang)}</span>` : ''}
  ${sparkline(s.daily, s.host)}
  <span class="spark-cap">${t.lastDays.replace('{days}', () => daysText(data.period?.days ?? s.daily.length, lang))}</span>
  <span class="more">${t.more}</span>
</a>`;
  }).join('');
}

export function appBlock(app, lang) {
  const t = T[lang];
  if (!app || !app.latest) return '';
  const url = app.latest.url;
  const version = typeof url === 'string' && url.startsWith('https://github.com/')
    ? `<a href="${esc(url)}">${esc(app.latest.version)}</a>` : `<span>${esc(app.latest.version)}</span>`;
  return `<section class="app"><h3>${t.app}</h3><dl>
  <div><dt>${t.latest}</dt><dd>${version} <small>${esc(app.latest.published)}</small></dd></div>
  <div><dt>${t.latestDownloads}</dt><dd>${fmt(app.latest.downloads, lang)}</dd></div>
  <div><dt>${t.totalDownloads}</dt><dd>${fmt(app.total_downloads, lang)} <small>${t.allTime} · ${fmt(app.releases, lang)} ${t.releases}</small></dd></div>
</dl></section>`;
}

export function details(site, app, lang) {
  const t = T[lang];
  const desc = about(site.host, lang);
  const head = `<a class="back" href="#">${t.back}</a><h2 class="site-title">${iconTag(site.host, 36, ' site-icon-lg')}${esc(site.host)}</h2>`
    + (desc ? `<p class="site-about">${desc}</p>` : '');
  const appHtml = app && app.site === site.host ? appBlock(app, lang) : '';
  const robots = list({
    title: t.bots, hint: t.hintBots, items: site.bots?.list ?? [], total: site.bots?.requests ?? 0, lang,
    label: (b) => `${b.name} · ${({ search: t.catSearch, ai: t.catAi, other: t.catOther })[b.category] ?? t.catOther}`
  });
  let body;
  if (site.visits) {
    const of = (title, hint, items, extra = {}) => list({ title, hint, items, total: site.visits, lang, ...extra });
    body = `<p class="total"><span class="big">${fmt(site.visits, lang)}</span> ${plural(site.visits, t.peopleOne, t.peopleFew, t.peopleMany, lang)}</p>
${bars(site.daily, lang, site.host)}
${appHtml}
<div class="lists">
${of(t.pages, t.hintPages, site.pages.map((p) => ({ ...p, name: p.path })), { label: (p) => (p.title ? `${p.path} — ${p.title}` : p.path) })}
${of(t.referrers, t.hintReferrers, site.referrers, { empty: 'direct' })}
${of(t.countries, t.hintCountries, site.countries)}
${of(t.languages, t.hintLanguages, site.languages ?? [])}
${of(t.browsers, '', site.browsers)}
${of(t.systems, '', site.systems)}
${robots}
</div>`;
  } else {
    body = `<p class="empty">${t.noData}</p>${appHtml}${robots ? `<div class="lists">${robots}</div>` : ''}`;
  }
  return `<div class="site"${colorAttr(site.host)}>${head}${body}</div>`;
}

export function collected(lang) {
  const t = T[lang];
  const li = (keys) => keys.map((k) => `<li>${t[k]}</li>`).join('');
  return `<h2>${t.collectedTitle}</h2>
<div class="cols"><div><h3>${t.keptTitle}</h3><ul class="yes">${li(['cPage', 'cTime', 'cReferrer', 'cCountry', 'cLanguage', 'cBrowser', 'cSystem'])}</ul>
<p class="note">${t.cBots}</p></div>
<div><h3>${t.notKeptTitle}</h3><ul class="no">${li(['nCookies', 'nIp', 'nSize'])}</ul></div></div>
<p class="only">${t.summaryOnly}</p>
<p class="foot">${t.counterNote} <a href="https://github.com/arp242/goatcounter">GoatCounter</a> · <a href="https://github.com/wyrtensi/stats">${t.source}</a></p>`;
}

export function updated(generated, now, lang) {
  const t = T[lang];
  const at = new Date(generated);
  if (Number.isNaN(at.getTime())) return `${t.updated}: — <strong>${t.stale}</strong>`;
  const when = at.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const stale = now - at > 30 * 60 * 1000 ? ` — <strong>${t.stale}</strong>` : '';
  return `${t.updated}: ${esc(when)}${stale}`;
}

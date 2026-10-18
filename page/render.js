// Pure rendering: data in, HTML strings out. No DOM access, so it is testable in Node.
import { T, plural } from './i18n.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const fmt = (n, lang) => new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US').format(n);

// Each site's colour is a data-color attribute that CSS maps to --site-1..3;
// `about` is the i18n key of the one-line description.
export const SITE_INFO = {
  'rusinternet.com': { color: 'site-1', about: 'aboutRusinternet' },
  'wystore.ru': { color: 'site-2', about: 'aboutWystore' },
  'washguide.ru': { color: 'site-3', about: 'aboutWashguide' }
};

const info = (host) => (Object.hasOwn(SITE_INFO, host) ? SITE_INFO[host] : null);
const colorAttr = (host) => (info(host) ? ` data-color="${info(host).color}"` : '');
const about = (host, lang) => (info(host) ? T[lang][info(host).about] : '');

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

function dateText(day, lang) {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(String(day)) ? new Date(`${day}T00:00:00Z`) : null;
  if (!at || Number.isNaN(at.getTime())) return String(day);
  return new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(at);
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

export function sparkline(daily, w = 120, h = 32) {
  const box = `class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"`;
  if (!daily.length) return `<svg ${box}></svg>`;
  const max = Math.max(1, ...daily.map((d) => d.visits));
  const step = daily.length > 1 ? w / (daily.length - 1) : 0;
  const pts = daily.map((d, i) => `${(i * step).toFixed(1)},${(h - 3 - (d.visits / max) * (h - 6)).toFixed(1)}`).join(' ');
  return `<svg ${box}><polyline points="${pts}" vector-effect="non-scaling-stroke"/></svg>`;
}

// Daily bars, at most 80% of the chart high. The rect reaches past the bottom
// edge by its corner radius, so only the top corners show rounded.
export function bars(daily, lang, w = 640, h = 160) {
  if (!daily.length) return '';
  const max = Math.max(1, ...daily.map((d) => d.visits));
  const bw = w / daily.length;
  const r = Math.min(4, Math.max(0, (bw - 2) / 2));
  const cols = daily.map((d, i) => {
    const bh = (d.visits / max) * h * 0.8;
    const x = (i * bw + 1).toFixed(1), width = Math.max(1, bw - 2).toFixed(1);
    const title = `${dateText(d.day, lang)}: ${peopleText(d.visits, lang)}`;
    return `<g><title>${esc(title)}</title><rect class="hit" x="${(i * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${h}"/>`
      + `<rect class="b" x="${x}" y="${(h - bh).toFixed(1)}" width="${width}" height="${(bh + r).toFixed(1)}" rx="${r.toFixed(1)}"/></g>`;
  }).join('');
  const first = dateText(daily[0].day, lang), last = dateText(daily[daily.length - 1].day, lang);
  const axis = daily.length > 1 ? `<span>${esc(first)}</span><span>${esc(last)}</span>` : `<span>${esc(first)}</span>`;
  return `<div class="chart"><svg class="bars" viewBox="0 0 ${w} ${h}" role="img">${cols}</svg><div class="axis">${axis}</div></div>`;
}

// One list: heading, plain hint, rows with count and share of `total`.
// GoatCounter names: "" is a direct visit for referrers and unknown elsewhere;
// "unknown" and "(unknown)" are unknown; "other" is the exporter's remainder.
function list({ title, hint, items, total, lang, label = (x) => x.name, empty = 'unknown' }) {
  if (!items.length) return '';
  const t = T[lang];
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

export function overview(data, lang) {
  const t = T[lang];
  return data.sites.map((s) => {
    const bots = s.bots?.requests ?? 0;
    const desc = about(s.host, lang);
    return `<a class="card" href="#${esc(s.host)}" data-site="${esc(s.host)}"${colorAttr(s.host)}>
  <span class="host"><span class="dot"></span>${esc(s.host)}</span>
  ${desc ? `<span class="about">${desc}</span>` : ''}
  <span class="count"><span class="big">${fmt(s.visits, lang)}</span> <span class="unit">${plural(s.visits, t.peopleOne, t.peopleFew, t.peopleMany, lang)}</span></span>
  ${bots ? `<span class="bots">${t.botsLine.replace('{n}', () => fmt(bots, lang))}</span>` : ''}
  ${sparkline(s.daily)}
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
  const head = `<a class="back" href="#">${t.back}</a><h2 class="site-title"><span class="dot"></span>${esc(site.host)}</h2>`
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
${bars(site.daily, lang)}
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

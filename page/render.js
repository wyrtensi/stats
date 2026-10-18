// Pure rendering: data in, HTML strings out. No DOM access, so it is testable in Node.
import { T } from './i18n.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const fmt = (n, lang) => new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US').format(n);

export function sparkline(daily, w = 120, h = 28) {
  if (!daily.length) return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
  const max = Math.max(1, ...daily.map((d) => d.visits));
  const step = daily.length > 1 ? w / (daily.length - 1) : 0;
  const pts = daily.map((d, i) => `${(i * step).toFixed(1)},${(h - 2 - (d.visits / max) * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

export function bars(daily, w = 640, h = 140) {
  const max = Math.max(1, ...daily.map((d) => d.visits));
  const bw = daily.length ? w / daily.length : w;
  const rects = daily.map((d, i) => {
    const bh = (d.visits / max) * (h - 16);
    return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${bh.toFixed(1)}"><title>${esc(d.day)}: ${d.visits}</title></rect>`;
  }).join('');
  return `<svg class="bars" viewBox="0 0 ${w} ${h}" role="img">${rects}</svg>`;
}

function list(title, items, lang, label = (x) => x.name) {
  if (!items.length) return '';
  const max = Math.max(1, ...items.map((x) => x.visits));
  const rows = items.map((x) => {
    const name = x.name === 'other' ? T[lang].other : (label(x) || T[lang].unknown);
    return `<li><span class="bar" data-w="${Math.round((x.visits / max) * 100)}"></span><span class="name">${esc(name)}</span><span class="num">${fmt(x.visits, lang)}</span></li>`;
  }).join('');
  return `<section class="list"><h3>${esc(title)}</h3><ol>${rows}</ol></section>`;
}

export function overview(data, lang) {
  const t = T[lang];
  return data.sites.map((s) => `<a class="card" href="#${esc(s.host)}" data-site="${esc(s.host)}">
  <span class="host">${esc(s.host)}</span>
  <span class="big">${fmt(s.visits, lang)}</span><span class="unit">${t.people}</span>
  <span class="bots">${fmt(s.bots?.requests ?? 0, lang)} ${t.botRequests}</span>
  ${sparkline(s.daily)}
</a>`).join('');
}

export function appBlock(app, lang) {
  const t = T[lang];
  if (!app || !app.latest) return '';
  return `<section class="app"><h3>${t.app}</h3><dl>
  <div><dt>${t.latest}</dt><dd><a href="${esc(app.latest.url)}">${esc(app.latest.version)}</a> <small>${esc(app.latest.published)}</small></dd></div>
  <div><dt>${t.latestDownloads}</dt><dd>${fmt(app.latest.downloads, lang)}</dd></div>
  <div><dt>${t.totalDownloads}</dt><dd>${fmt(app.total_downloads, lang)} <small>${t.allTime} · ${fmt(app.releases, lang)} ${t.releases}</small></dd></div>
</dl></section>`;
}

export function details(site, app, lang) {
  const t = T[lang];
  const head = `<a class="back" href="#">${t.back}</a><h2>${esc(site.host)}</h2>`;
  const appHtml = app && app.site === site.host ? appBlock(app, lang) : '';
  if (!site.visits && !site.bots?.requests) return `${head}${appHtml}<p class="empty">${t.noData}</p>`;
  return `${head}<p class="total"><span class="big">${fmt(site.visits, lang)}</span> ${t.visits}</p>
${bars(site.daily)}
${appHtml}
<div class="lists">
${list(t.pages, site.pages.map((p) => ({ ...p, name: p.path })), lang, (p) => p.title ? `${p.path} — ${p.title}` : p.path)}
${list(t.referrers, site.referrers, lang)}
${list(t.countries, site.countries, lang)}
${list(t.browsers, site.browsers, lang)}
${list(t.systems, site.systems, lang)}
${list(t.bots, site.bots?.list ?? [], lang,
  (b) => `${b.name} · ${({ search: t.catSearch, ai: t.catAi, other: t.catOther })[b.category] ?? t.catOther}`)}
</div>`;
}

export function collected(lang) {
  const t = T[lang];
  const li = (keys) => keys.map((k) => `<li>${t[k]}</li>`).join('');
  return `<h2>${t.collectedTitle}</h2>
<div class="cols"><div><h3>${t.keptTitle}</h3><ul class="yes">${li(['cPage', 'cReferrer', 'cCountry', 'cBrowser', 'cSystem'])}</ul>
<p class="note">${t.cBots}</p></div>
<div><h3>${t.notKeptTitle}</h3><ul class="no">${li(['nCookies', 'nIp', 'nSize', 'nLanguage', 'nVisits'])}</ul></div></div>
<p>${t.counterNote} <a href="https://github.com/arp242/goatcounter">GoatCounter</a> · <a href="https://github.com/wyrtensi/stats">${t.source}</a></p>`;
}

export function updated(generated, now, lang) {
  const t = T[lang];
  const at = new Date(generated);
  const when = at.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const stale = now - at > 30 * 60 * 1000 ? ` — <strong>${t.stale}</strong>` : '';
  return `${t.updated}: ${esc(when)}${stale}`;
}

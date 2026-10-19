import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { T } from '../page/i18n.js';
import * as R from '../page/render.js';

const data = JSON.parse(await readFile(new URL('./sample.json', import.meta.url), 'utf8'));

test('each card and the details title show the site icon', () => {
  const html = R.overview(data, 'ru');
  for (const [host, icon] of [['rusinternet.com', '/icons/rusinternet.svg'], ['wystore.ru', '/icons/wystore.png'], ['washguide.ru', '/icons/washguide.svg'], ['wyrtensi.github.io/showmehow', '/icons/showmehow.svg']]) {
    assert.ok(html.includes(`src="${icon}"`), host);
  }
  assert.ok(R.details(data.sites[0], null, 'ru').includes('src="/icons/rusinternet.svg"'));
  assert.match(html, /<img class="site-icon" src="\/icons\/rusinternet\.svg" alt="" width="28" height="28">/);
});

test('robots line agrees with the number', () => {
  const one = structuredClone(data); one.sites[0].bots = { requests: 1, list: [] };
  const two = structuredClone(data); two.sites[0].bots = { requests: 2, list: [] };
  assert.ok(R.overview(one, 'ru').includes('1 запрос от'));
  assert.ok(R.overview(two, 'ru').includes('2 запроса от'));
  assert.ok(R.overview(data, 'ru').includes('57 запросов от'));
  assert.ok(R.overview(one, 'en').includes('1 request from'));
});

test('empty, "unknown" and "(unknown)" names become one unknown row', () => {
  const site = structuredClone(data.sites[0]);
  site.languages = [{ name: 'Russian', visits: 10 }, { name: '', visits: 2 }, { name: '(unknown)', visits: 1 }, { name: 'unknown', visits: 1 }];
  const html = R.details(site, null, 'ru');
  assert.equal(html.split(`>${T.ru.unknown}<`).length - 1, 1);
  assert.match(html, /4 · 33%/);
});

test('a direct referrer stays separate from unknown referrers', () => {
  const site = structuredClone(data.sites[0]);
  site.languages = [];
  site.referrers = [{ name: '', visits: 3 }, { name: 'unknown', visits: 2 }, { name: '(unknown)', visits: 1 }];
  const html = R.details(site, null, 'ru');
  assert.equal(html.split(`>${T.ru.direct}<`).length - 1, 1);
  assert.equal(html.split(`>${T.ru.unknown}<`).length - 1, 1);
  assert.match(html, /3 · 25%/);
});

test('a host with a slash gives plain ids, an anchor link and a card with no bot line', () => {
  const host = 'wyrtensi.github.io/showmehow';
  const site = data.sites.find((s) => s.host === host);
  const card = R.overview({ ...data, sites: [site] }, 'ru');
  assert.ok(card.includes(`href="#${host}"`) && card.includes(`data-site="${host}"`));
  assert.ok(card.includes(`${host}</span>`));
  assert.ok(card.includes(T.ru.aboutShowmehow));
  assert.match(card, /data-color="site-4"/);
  assert.ok(!card.includes('class="bots"'));
  const ids = [...card.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 0);
  for (const id of ids) assert.match(id, /^[A-Za-z][A-Za-z0-9_-]*$/, id);
  const chart = R.bars([{ day: '2026-10-18', visits: 2 }], 'en', host);
  for (const m of chart.matchAll(/ id="([^"]*)"/g)) assert.match(m[1], /^[A-Za-z][A-Za-z0-9_-]*$/, m[1]);
  assert.ok(chart.includes(`url(#${[...chart.matchAll(/ id="([^"]*)"/g)][0][1]})`));
});

test('a site with no bot data renders without NaN, undefined or broken bars', () => {
  const host = 'wyrtensi.github.io/showmehow';
  const base = data.sites.find((s) => s.host === host);
  const busy = { ...base, visits: 4, daily: [{ day: '2026-10-17', visits: 0 }, { day: '2026-10-18', visits: 4 }],
    pages: [{ path: '/', title: '', visits: 4 }], countries: [{ name: 'Russia', visits: 4 }] };
  for (const bots of [{ requests: 0, list: [] }, undefined, null]) {
    const site = { ...busy }; if (bots === undefined) delete site.bots; else site.bots = bots;
    for (const html of [R.overview({ ...data, sites: [site] }, 'en'), R.details(site, null, 'en'), R.details({ ...site, visits: 0, daily: [] }, null, 'ru')]) {
      assert.ok(!/NaN|undefined|null|Infinity/.test(html));
      assert.ok(!html.includes('class="bots"') && !html.includes(T.en.bots) && !html.includes(T.ru.bots));
    }
  }
  const html = R.details(busy, null, 'en');
  for (const m of html.matchAll(/data-w="([^"]*)"/g)) assert.ok(Number.isFinite(Number(m[1])) && Number(m[1]) >= 0 && Number(m[1]) <= 100);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { T } from '../page/i18n.js';
import * as R from '../page/render.js';

const data = JSON.parse(await readFile(new URL('./sample.json', import.meta.url), 'utf8'));

test('each card and the details title show the site icon', () => {
  const html = R.overview(data, 'ru');
  for (const [host, icon] of [['rusinternet.com', '/icons/rusinternet.svg'], ['wystore.ru', '/icons/wystore.png'], ['washguide.ru', '/icons/washguide.svg']]) {
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { T, pickLang, plural } from '../page/i18n.js';
import * as R from '../page/render.js';

const data = JSON.parse(await readFile(new URL('./sample.json', import.meta.url), 'utf8'));

test('summary names the total and the busiest site, with Russian plurals', () => {
  const ru = R.summary(data, 'ru');
  assert.match(ru, /15 человек/);
  assert.ok(ru.includes('rusinternet.com'));
  const one = structuredClone(data); one.sites = [{ ...data.sites[0], visits: 1 }, { ...data.sites[1], visits: 0 }, { ...data.sites[2], visits: 0 }];
  // JS \b is ASCII-only, so it never matches after a Cyrillic letter; the
  // lookahead keeps the intent: "1 человек", not "1 человека".
  assert.match(R.summary(one, 'ru'), /1 человек(?![а-яё])/);
  const none = structuredClone(data); for (const s of none.sites) s.visits = 0;
  assert.ok(R.summary(none, 'ru').includes(T.ru.summaryNone.replace('{days}', '7 дней')));
});

test('summary in English', () => {
  assert.equal(R.summary(data, 'en'), 'In the last 7 days, 15 people visited our sites. Most went to rusinternet.com.');
});

test('Russian and English plural rules', () => {
  const f = (n, lang) => plural(n, 'one', 'few', 'many', lang);
  assert.deepEqual([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map((n) => f(n, 'ru')),
    ['one', 'few', 'few', 'many', 'many', 'many', 'many', 'one', 'few', 'many', 'one', 'many']);
  assert.deepEqual([0, 1, 2, 21].map((n) => f(n, 'en')), ['many', 'one', 'many', 'many']);
});

test('shares', () => {
  assert.equal(R.pct(9, 12), '75%');
  assert.equal(R.pct(1, 300), '<1%');
  assert.equal(R.pct(0, 12), '0%');
  assert.equal(R.pct(0, 0), '0%');
});

test('cards carry site colour, description and Details link', () => {
  const html = R.overview(data, 'ru');
  assert.ok(html.includes(T.ru[R.SITE_INFO['wystore.ru'].about]));
  assert.ok(html.includes(T.ru.more));
  assert.match(html, /data-color="site-1"/);
  assert.deepEqual(Object.values(R.SITE_INFO).map((s) => s.color), ['site-1', 'site-2', 'site-3']);
  assert.ok(html.includes(T.ru.botsMany.replace('{n}', '57')));
  assert.match(html, />3<\/span> <span class="unit">человека</);
});

test('plain names: unknown, other, direct', () => {
  const html = R.details(data.sites[0], null, 'ru');
  assert.ok(html.includes(T.ru.unknown) && html.includes(T.ru.direct) && html.includes(T.ru.other));
  assert.ok(!/>unknown</.test(html));
  assert.ok(!html.includes('(unknown)'), '"(unknown)" from GoatCounter shows as T.ru.unknown');
  assert.ok(html.includes(T.ru.languages) && html.includes(T.ru.hintLanguages));
  assert.match(html, /9 · 75%/);
});

test('robot shares are of bot requests', () => {
  assert.match(R.details(data.sites[0], null, 'ru'), /40 · 70%/);
});

test('details total uses the card wording', () => {
  const html = R.details(data.sites[0], null, 'ru');
  assert.match(html, /<span class="big">12<\/span> человек/);
});

test('a site with no people but some robots shows the no-data line and the robots', () => {
  const site = { ...data.sites[1], bots: data.sites[0].bots };
  const html = R.details(site, null, 'ru');
  assert.ok(html.includes(T.ru.noData));
  assert.ok(html.includes('YandexBot'));
  assert.ok(!html.includes('class="bars"'));
  assert.ok(!html.includes('class="total"'));
});

test('daily chart: escaped, formatted titles, at most 80% high, first and last date', () => {
  const daily = [{ day: '2026-10-17', visits: 1500 }, { day: '<x>', visits: 7 }, { day: '2026-10-18', visits: 3 }];
  const html = R.bars(daily, 'ru');
  assert.ok(html.includes('17 окт.'));
  assert.ok(html.includes('1 500'));
  assert.ok(!html.includes('<x>'));
  const h = Number(html.match(/viewBox="0 0 \d+ (\d+)"/)[1]);
  const tallest = Math.max(...[...html.matchAll(/<rect class="b" [^>]*y="([\d.]+)"/g)].map((m) => h - Number(m[1])));
  assert.ok(tallest <= h * 0.8 + 0.01, `${tallest} of ${h}`);
  assert.match(html, /class="axis"><span>17 окт\.<\/span><span>18 окт\.<\/span>/);
  assert.equal(R.bars([], 'ru'), '');
});

test('collected block matches the counter settings', () => {
  const html = R.collected('ru');
  for (const k of ['cPage', 'cTime', 'cReferrer', 'cCountry', 'cLanguage', 'cBrowser', 'cSystem', 'cBots', 'nCookies', 'nIp', 'nSize', 'summaryOnly'])
    assert.ok(html.includes(T.ru[k]), k);
});

test('pickLang uses the whole primary subtag', () => {
  assert.equal(pickLang('uk-UA', null), 'ru');
  assert.equal(pickLang('ukl', null), 'en');
  assert.equal(pickLang('bem', null), 'en');
});

test('unparseable generated counts as stale', () => {
  assert.ok(R.updated('not a date', new Date(), 'en').includes(T.en.stale));
});

test('app link only to GitHub', () => {
  const bad = structuredClone(data.app); bad.latest.url = 'javascript:alert(1)';
  assert.ok(!R.appBlock(bad, 'en').includes('javascript:'));
  assert.ok(R.appBlock(bad, 'en').includes('v0.4.1'));
  assert.ok(R.appBlock(data.app, 'en').includes('href="https://github.com/wyrtensi/wystore/releases/tag/v0.4.1"'));
});

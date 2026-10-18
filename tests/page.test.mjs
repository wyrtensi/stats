import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pickLang, T } from '../page/i18n.js';
import * as R from '../page/render.js';

const data = JSON.parse(await readFile(new URL('./sample.json', import.meta.url), 'utf8'));

test('language: saved choice wins, then browser language family', () => {
  assert.equal(pickLang('en-US', 'ru'), 'ru');
  assert.equal(pickLang('uk-UA', null), 'ru');
  assert.equal(pickLang('kk', null), 'ru');
  assert.equal(pickLang('de-DE', null), 'en');
});

test('both languages define the same keys', () => {
  assert.deepEqual(Object.keys(T.ru).sort(), Object.keys(T.en).sort());
});

test('overview has one card per site in order, with visits', () => {
  const html = R.overview(data, 'en');
  const hosts = [...html.matchAll(/data-site="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hosts, ['rusinternet.com', 'wystore.ru', 'washguide.ru']);
  assert.match(html, /12/);
  assert.match(html, /<svg/);
});

test('details escape data and show every list', () => {
  const html = R.details(data.sites[0], data.app, 'en');
  assert.ok(!html.includes('<b>Android</b>'));
  assert.ok(html.includes('&lt;b&gt;Android&lt;/b&gt;'));
  for (const k of ['pages', 'referrers', 'countries', 'languages', 'browsers', 'systems']) assert.ok(html.includes(T.en[k]), k);
  assert.ok(html.includes(T.en.other));
});

test('the app block appears only for wystore.ru', () => {
  assert.ok(!R.details(data.sites[0], data.app, 'ru').includes('v0.4.1'));
  const wy = R.details(data.sites[1], data.app, 'ru');
  assert.ok(wy.includes('v0.4.1') && wy.includes('812') && wy.includes('33'));
  assert.ok(wy.includes(T.ru.allTime));
});

test('empty site shows a no-data note instead of empty tables', () => {
  assert.ok(R.details(data.sites[1], null, 'en').includes(T.en.noData));
});

test('stale note after 30 minutes', () => {
  assert.ok(!R.updated(data.generated, new Date('2026-10-18T16:20:00Z'), 'en').includes(T.en.stale));
  assert.ok(R.updated(data.generated, new Date('2026-10-18T16:40:00Z'), 'en').includes(T.en.stale));
});

test('collected block lists what is and is not kept', () => {
  const html = R.collected('en');
  for (const k of ['cPage', 'cTime', 'cReferrer', 'cCountry', 'cLanguage', 'cBrowser', 'cSystem', 'nCookies', 'nIp', 'nSize'])
    assert.ok(html.includes(T.en[k]), k);
});

test('index.html loads only same-origin resources and no inline code', async () => {
  const html = await readFile(new URL('../page/index.html', import.meta.url), 'utf8');
  assert.ok(!/(src|href)="(https?:)?\/\//.test(html.replace(/<a [^>]*>/g, '')), 'no external src/href except links');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'no inline scripts');
  assert.ok(!/\sstyle=/.test(html), 'no style attributes');
  assert.match(html, /<script type="module" src="\/app\.js"><\/script>/);
  const gh = html.match(/<a [^>]*id="github"[^>]*>/)?.[0] ?? '';
  assert.match(gh, /href="https:\/\/github\.com\/wyrtensi\/stats"/);
  assert.match(gh, /rel="noopener"/);
  assert.match(gh, /target="_blank"/);
  assert.match(gh, /aria-label="[^"]+"/);
  assert.ok(html.indexOf('id="github"') < html.indexOf('id="lang"'), 'GitHub link sits before the language button');
});

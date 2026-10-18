import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { T } from '../page/i18n.js';
import * as R from '../page/render.js';

const data = JSON.parse(await readFile(new URL('./sample.json', import.meta.url), 'utf8'));

test('cards show people and bot requests separately', () => {
  const html = R.overview(data, 'en');
  assert.ok(html.includes(T.en.peopleMany));
  assert.ok(html.includes(T.en.botsLine.replace('{n}', '57')));
});

test('details list bots with their category', () => {
  const html = R.details(data.sites[0], null, 'ru');
  assert.ok(html.includes(T.ru.bots));
  assert.ok(html.includes('YandexBot') && html.includes(T.ru.catSearch));
  assert.ok(html.includes('GPTBot') && html.includes(T.ru.catAi));
});

test('collected block mentions what is kept for bots', () => {
  assert.ok(R.collected('en').includes(T.en.cBots));
});

test('files without bots still render', () => {
  const old = structuredClone(data);
  for (const s of old.sites) delete s.bots;
  assert.doesNotThrow(() => R.overview(old, 'en'));
  assert.doesNotThrow(() => R.details(old.sites[0], null, 'en'));
});

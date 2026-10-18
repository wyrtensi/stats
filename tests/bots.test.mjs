import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { T } from '../page/i18n.js';
import * as R from '../page/render.js';

const data = JSON.parse(await readFile(new URL('./sample.json', import.meta.url), 'utf8'));

test('cards show people and bot requests separately', () => {
  const html = R.overview(data, 'en');
  assert.ok(html.includes(T.en.peopleMany));
  assert.ok(html.includes(T.en.botsMany.replace('{n}', '57')));
});

test('the robots line speaks of robots, not only search and AI', () => {
  for (const key of ['botsOne', 'botsFew', 'botsMany']) {
    assert.ok(!/ИИ|AI|search|поиск/i.test(T.ru[key] + T.en[key]), key);
  }
  assert.equal(T.ru.botsOne, 'и {n} запрос от роботов');
  assert.equal(T.ru.botsFew, 'и {n} запроса от роботов');
  assert.equal(T.ru.botsMany, 'и {n} запросов от роботов');
  assert.equal(T.en.botsOne, 'and {n} request from robots');
  assert.equal(T.en.botsMany, 'and {n} requests from robots');
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

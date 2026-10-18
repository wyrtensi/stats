import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { T } from '../page/i18n.js';
import * as R from '../page/render.js';

const days = (counts, last = '2026-10-18') => counts.map((n, i) => {
  const d = new Date(`${last}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - (counts.length - 1 - i));
  return { day: d.toISOString().slice(0, 10), visits: n };
});

test('niceMax', () => {
  assert.equal(R.niceMax(0), 1); assert.equal(R.niceMax(1), 1); assert.equal(R.niceMax(3), 5);
  assert.equal(R.niceMax(7), 10); assert.equal(R.niceMax(12), 20); assert.equal(R.niceMax(51), 100);
});

test('day labels', () => {
  assert.equal(R.dayLabel('2026-10-18', 'ru'), '18 окт');
  assert.equal(R.dayLabel('2026-10-18', 'en'), '18 Oct');
});

test('chart: one bar group per day with data and a title', () => {
  const svg = R.bars(days([0, 3, 7]), 'ru', 'rusinternet.com');
  assert.equal((svg.match(/data-day="/g) || []).length, 3);
  assert.ok(svg.includes('data-n="7"') && svg.includes('tabindex="0"'));
  assert.ok(svg.includes('7 человек'));
  assert.ok(!/\sstyle=/.test(svg));
});

test('chart: grid lines at 0, half and nice max with labels', () => {
  const svg = R.bars(days([1, 7]), 'en', 'wystore.ru');
  for (const v of ['>0<', '>5<', '>10<']) assert.ok(svg.includes(v), v);
});

test('chart: date labels thin out for longer periods', () => {
  const count = (svg) => (svg.match(/class="xlabel"/g) || []).length;
  assert.equal(count(R.bars(days(Array(7).fill(1)), 'en', 'washguide.ru')), 7);
  assert.ok(count(R.bars(days(Array(30).fill(1)), 'en', 'washguide.ru')) <= 6);
  assert.ok(count(R.bars(days(Array(90).fill(1)), 'en', 'washguide.ru')) <= 8);
});

test('facts line: average and peak, plurals agree', () => {
  assert.equal(R.chartFacts(days([0, 3, 7, 7]), 'ru'), 'В среднем 4,3 человека в день · больше всего 7 — 18 окт');
  assert.equal(R.chartFacts(days([0, 0]), 'en'), T.en.noVisitsPeriod);
});

test('sparkline: area, line and last-day dot even for one day', () => {
  const one = R.sparkline(days([5]), 'rusinternet.com');
  assert.ok(one.includes('<circle') && one.includes('<path'));
  const many = R.sparkline(days([1, 2, 3]), 'wystore.ru');
  assert.ok(many.includes('linearGradient') && many.includes('id="g-wystore-ru"'));
});

test('index.html has the tooltip element', async () => {
  const html = await readFile(new URL('../page/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="tip"/);
});

test('page server sends no-cache site-wide', async () => {
  const c = await readFile(new URL('../deploy/server/Caddyfile', import.meta.url), 'utf8');
  assert.equal((c.match(/Cache-Control "no-cache"/g) || []).length, 1);
  assert.ok(!/@assets|@data/.test(c));
});

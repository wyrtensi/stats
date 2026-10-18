import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
const sh = process.platform === 'win32' ? 'C:/Program Files/Git/bin/sh.exe' : '/bin/sh';

function run(command) {
  try {
    execFileSync(sh, ['deploy/server/stats-deploy.sh'], { env: { ...process.env, SSH_ORIGINAL_COMMAND: command }, stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stderr: '' };
  } catch (e) { return { status: e.status ?? 1, stderr: String(e.stderr ?? '') }; }
}

test('forced command refuses everything but rsync and activate', { skip: !existsSync(sh) }, () => {
  for (const c of ['id', 'sh -c id', 'rsync --sender', '']) {
    const r = run(c);
    assert.notEqual(r.status, 0, c);
    assert.match(r.stderr, /command not allowed/);
  }
  for (const c of ['activate ../../etc', 'activate a/b', 'activate ', 'activate A1']) {
    assert.match(run(c).stderr, /invalid release name/, c);
  }
});

test('activate links the shared data directory into the release', async () => {
  const s = await read('deploy/server/stats-deploy.sh');
  assert.match(s, /ln -sfn \.\.\/\.\.\/data "\$site\/releases\/\$release\/data"/);
});

test('goatcounter serves under /admin; stats-web is small and read-only', async () => {
  const c = await read('deploy/server/docker-compose.yml');
  assert.match(c, /"-base-path", "\/admin"/);
  assert.match(c, /container_name: stats-web[\s\S]*mem_limit: 32m/);
  assert.match(c, /\.\/page:\/srv:ro/);
});

test('edge route: /admin to goatcounter, the rest to the page', async () => {
  const r = await read('deploy/server/stats.wyrtensi.caddy');
  assert.match(r, /@admin path \/admin \/admin\/\*/);
  assert.match(r, /reverse_proxy goatcounter:8080/);
  assert.match(r, /reverse_proxy stats-web:80/);
});

test('page server sends the strict CSP', async () => {
  const c = await read('deploy/server/Caddyfile');
  assert.ok(c.includes("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"));
});

// Post-deploy check: page, fresh data, private admin, counter still reachable.
const base = 'https://stats.wyrtensi.ru';
const attempts = Number(process.env.SMOKE_ATTEMPTS ?? 10);

async function check() {
  const problems = [];
  try {
    const page = await fetch(`${base}/`, { redirect: 'manual' });
    if (page.status !== 200 || !page.headers.get('content-type')?.startsWith('text/html')) problems.push(`page: HTTP ${page.status}`);
    if (!page.headers.get('content-security-policy')?.includes("default-src 'none'")) problems.push('page: CSP missing');
    const data = await fetch(`${base}/data/30.json`);
    if (data.status !== 200) problems.push(`data: HTTP ${data.status}`);
    else {
      const json = await data.json();
      const age = Date.now() - Date.parse(json.generated);
      if (!(age < 30 * 60 * 1000)) problems.push(`data: generated ${json.generated} is older than 30 minutes`);
      if (json.sites?.length !== 3) problems.push('data: expected 3 sites');
    }
    const admin = await fetch(`${base}/admin/settings/main`, { redirect: 'manual' });
    if (admin.status < 300 || admin.status > 399) problems.push(`admin settings without login: HTTP ${admin.status}, expected a redirect`);
    const counter = await fetch('https://rusinternet.com/stats/count.js');
    if (counter.status !== 200) problems.push(`rusinternet counter script: HTTP ${counter.status}`);
  } catch (err) {
    problems.push(`${err.cause?.code ?? err.name}: ${err.cause?.message ?? err.message}`);
  }
  return problems;
}

for (let i = 1; ; i += 1) {
  const problems = await check();
  if (!problems.length) { console.log('Production OK: page, fresh data, private admin, counter script.'); break; }
  if (i >= attempts) { console.error(problems.map((p) => `- ${p}`).join('\n')); process.exit(1); }
  console.log(`Attempt ${i}: ${problems.length} problem(s), retrying in 30s.`);
  await new Promise((r) => setTimeout(r, 30_000));
}

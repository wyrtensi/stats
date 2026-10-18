# Public stats page for stats.wyrtensi.ru

Date: 2026-10-18. Status: approved design, before the implementation plan.

## Goal

rusinternet.com, wystore.ru and washguide.ru count page views with one shared
GoatCounter on our server. Their footers promise that everything the counter
keeps is public at https://stats.wyrtensi.ru/. Today that link opens the stock
GoatCounter dashboard. Replace it with our own page: calm, readable, in a
neutral "wyrtensi" style, showing exactly what is collected and nothing more.

## What exists today

- GoatCounter 2.7.0 in `/opt/stats` (container `goatcounter`, SQLite, network
  `proxy`, `mem_limit: 96m`). Its compose file is in
  `wyrtensi/rusinternet` `deploy/server/stats/`.
- One GoatCounter site, vhost `stats.wyrtensi.ru`. Every page records its path
  with the host in front: `/rusinternet.com/install/android/`, `/wystore.ru/en/`,
  `/washguide.ru/m/...`.
- Collected: sessions (8 h unique-visitor hash), referrer, browser and system
  (from User-Agent; the header itself is not stored), country. Not collected:
  individual pageviews, screen size, region, language. No cookies, no IP stored.
- The dashboard is public ("Anyone"); settings need a login.
- Each site's edge route passes only `/stats/count` and `/stats/count.js` to
  `goatcounter:8080`, after `uri strip_prefix /stats`, with
  `Host: stats.wyrtensi.ru`.

## Decisions

| Question | Decision |
|---|---|
| Where the data comes from | A timer on the server exports aggregates from the GoatCounter API to static JSON every 10 minutes. The page reads only those files. |
| Rejected | Edge proxying the live API with the token (token in edge config, every view hits the API); a backend service (not needed for three sites). |
| Style | Neutral and shared, not borrowed from any of the three sites. |
| Content | Overview of three sites, then details of the selected one. |
| Stock dashboard | Moves to `stats.wyrtensi.ru/admin` (`-base-path /admin`) and goes back to private. Our page shows everything collected, so the footers stay true. |
| Repository | New public repo `wyrtensi/stats`; the GoatCounter files move here from rusinternet. |

## Architecture

```
browser ──> edge-caddy ── stats.wyrtensi.ru/admin*  ──> goatcounter:8080 (base path /admin)
                       └─ stats.wyrtensi.ru/*       ──> stats-web:80 (static page + data/*.json)

site pages ──> <site>/stats/count* ──> edge ──> goatcounter:8080/admin/count*

stats-export.timer (every 10 min, root)
  └─ stats-export.py ── GET /admin/api/v0/... (Bearer token from /etc/stats/token)
                    └─ writes /opt/stats/page/data/{7,30,90}.json atomically
```

Units, each with one job:

1. **GoatCounter** (`deploy/server/docker-compose.yml`): unchanged, plus
   `-base-path /admin`.
2. **stats-web** (same compose file): `caddy:2-alpine`, `mem_limit: 32m`, no
   published ports, serves `/opt/stats/page` read-only. Headers: strict CSP
   (`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self';
   connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors
   'none'`), `Cache-Control: no-cache` for `/data/*`, one hour for assets.
3. **Edge route** (`deploy/server/stats.wyrtensi.caddy`): HSTS, `-Server`;
   `/admin` and `/admin/*` to `goatcounter:8080`; everything else to
   `stats-web:80`.
4. **Exporter** (`export/stats-export.py`, Python 3 standard library only):
   reads the token, calls the API, writes JSON. Installed as
   `/usr/local/bin/stats-export` with `deploy/server/stats-export.service` and
   `.timer` (`OnCalendar=*:0/10`, `Persistent=true`).
5. **Page** (`page/index.html`, `page/app.js`, `page/style.css`, `page/i18n.js`,
   icons): no build step, no dependencies, no external requests.
6. **Site routes**: in each of the three repos, the counter route becomes
   `uri replace /stats/ /admin/` instead of `uri strip_prefix /stats`. Pages do
   not change.

## Token

Created on the server, never shown in chat or committed:

```sh
docker exec goatcounter goatcounter db -db=sqlite+/home/goatcounter/goatcounter-data/db.sqlite3 \
  create apitoken -user 1 -name stats-export -perm read_stats
```

The output goes straight into `/etc/stats/token` (mode 0600, root). The
permission is the narrowest that can read statistics; the exact permission name
is confirmed with `goatcounter help db` during implementation.

## Data file

One file per period, `data/7.json`, `data/30.json`, `data/90.json`:

```json
{
  "generated": "2026-10-18T16:10:00Z",
  "period": { "days": 30, "start": "2026-09-19", "end": "2026-10-18" },
  "collected": ["page", "referrer", "country", "browser", "system"],
  "sites": [
    {
      "host": "rusinternet.com",
      "visits": 1234,
      "daily": [{ "day": "2026-09-19", "visits": 40 }],
      "pages": [{ "path": "/install/android/", "title": "...", "visits": 300 }],
      "referrers": [{ "name": "yandex.ru", "visits": 200 }],
      "countries": [{ "name": "Russia", "visits": 900 }],
      "browsers": [{ "name": "Chrome", "visits": 700 }],
      "systems": [{ "name": "Android", "visits": 600 }]
    }
  ],
  "app": {
    "site": "wystore.ru",
    "repo": "wyrtensi/wystore",
    "latest": { "version": "v0.4.1", "published": "2026-10-18", "downloads": 120,
                "url": "https://github.com/wyrtensi/wystore/releases/tag/v0.4.1" },
    "total_downloads": 3400,
    "releases": 12,
    "fetched": "2026-10-18T16:10:00Z"
  }
}
```

- Sites are fixed in the exporter: `rusinternet.com`, `wystore.ru`,
  `washguide.ru`, in that order. A path belongs to a site when it starts with
  `/<host>/` or equals `/<host>`; the prefix is cut off in `pages`.
- Per site and period the exporter collects the site's path IDs from
  `/api/v0/paths`, then calls `/stats/total`, `/stats/hits` (daily) and
  `/stats/{toprefs,locations,browsers,systems}` with `include_paths`.
  Lists keep the top 10; the rest is summed into "other".
- "visits" is the count the GoatCounter API returns for these endpoints, the
  same number the stock dashboard shows as visits (unique per 8-hour session).
- Paths that match no site (stray or test counts) are left out.
- `app` (Wy Store downloads) comes from the public GitHub API,
  `GET https://api.github.com/repos/wyrtensi/wystore/releases?per_page=100`
  (all pages), without a token: six calls an hour stay far below the
  unauthenticated limit of 60. Drafts and pre-releases are skipped. `latest` is
  the newest published release; `downloads` counts its `.apk` assets;
  `total_downloads` sums the `.apk` assets of every release. Downloads are not
  limited to the period: GitHub only gives running totals.
- If the GitHub call fails, the exporter keeps the previous `app` block (read
  from the old file) instead of failing the whole run; the page shows the time
  it was last fetched (`app.fetched`).

## Page

- **Header:** "wyrtensi · stats", a one-line explanation, period switch
  (7 / 30 / 90 days, default 30), language switch (RU / EN), theme switch.
- **Overview:** three cards, one per site: name, visits for the period and a
  sparkline of daily visits.
- **Details:** clicking a card (or `#rusinternet.com` in the URL) shows that
  site: a daily bar chart, top pages, referrers, countries, browsers, systems.
  Each list is a simple table with proportional bars.
- **Wy Store app:** the wystore.ru card and its details also show the app:
  latest version with its release date (linked to the release), downloads of
  that version, and downloads of all versions, labelled "all time" because
  GitHub has no per-period numbers.
- **What we collect:** a fixed block listing what is kept (page, referrer,
  country, browser, system) and what is not (cookies, IP addresses, screen
  size, language, individual visits), with a link to GoatCounter's source.
- **Footer:** "Updated <time>" from `generated`; if the file is older than
  30 minutes, the time is shown with a note that the data may be stale.
- Language: from `navigator.language` (ru, uk, be, kk default to Russian, the
  rest to English), switch remembered in `localStorage` (try/catch).
- Theme: `prefers-color-scheme`, switch remembered the same way.
- Charts are inline SVG drawn by `app.js`; no chart library.
- The stats page does not count its own views.
- Works at 360 px width; no horizontal scroll.

### Style

Neutral and quiet: off-white / near-black backgrounds, one muted accent, system
font stack, generous spacing, thin rules instead of heavy cards, tabular
numbers. Colors are CSS custom properties with a dark-mode override.

## Errors

- API down or token rejected: the exporter exits non-zero, leaves the old
  files in place, and systemd logs it; the page shows the old `generated`
  time with the stale note.
- Partial failure for one site: the whole run fails (no half-updated files).
- Missing or broken JSON on the page: a short message instead of the
  sections; no console noise beyond one error.

## Deployment

- `stats-web` content deploys like the other sites: GitHub Actions
  `.github/workflows/site.yml` on push to `main` (paths `page/**`), environment
  `production` restricted to `main`, deploy user `stdeploy` with a forced
  command that only accepts rsync into a new release and `activate`. The data
  directory is outside the releases (`/opt/stats/page/data`, written by the
  exporter); `activate` adds a relative symlink `data -> ../../data` to the
  release, so stats-web (which mounts `/opt/stats/page` as `/srv` and serves
  `/srv/current`) finds it inside its root.
- Server pieces (compose, edge route, exporter, timer) are installed by hand,
  as for the other sites; CI does not touch them.
- Moving the dashboard to `/admin` and switching the site routes happen in one
  edge restart, after the page is live, so the counter is never unreachable.

## Testing

- Exporter: unit tests with recorded API responses (`export/tests/`): path to
  site mapping, prefix cut, top-10 plus "other", atomic write, failure keeps
  old files, release sums (drafts, pre-releases and non-APK assets skipped),
  GitHub failure keeps the previous `app` block.
- Page: a Node test (no dependencies) that loads a sample JSON and checks the
  rendered sections and numbers; a check that `index.html` has no external URLs
  and that all scripts are same-origin.
- Smoke after deploy: `https://stats.wyrtensi.ru/` answers 200 HTML;
  `data/30.json` is valid and `generated` is less than 30 minutes old;
  `https://stats.wyrtensi.ru/admin/settings/main` without a session redirects to
  the login page; `https://rusinternet.com/stats/count.js` still answers 200.

## Out of scope

- Per-page drill-down beyond the top 10, custom date ranges, exports.
- Any change to what is collected.
- Analytics for the stats page itself.

# Public Stats Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stock GoatCounter dashboard at https://stats.wyrtensi.ru/ with a light static page that shows, per site, everything the shared counter keeps, plus Wy Store's release downloads.

**Architecture:** A Python exporter (standard library only), run by a systemd timer every 10 minutes, reads the GoatCounter API, the GitHub releases API and new edge-caddy access-log lines (bots only: names and counts kept) and writes `data/7.json`, `data/30.json`, `data/90.json`. A static page (HTML, CSS, two ES modules, no dependencies) renders those files. A `stats-web` Caddy container serves the page; edge-caddy routes `/admin*` to GoatCounter (moved under `-base-path /admin`) and everything else to `stats-web`.

**Tech Stack:** Python 3.12 (server) / 3.13 (local), `unittest`; Node 24 `node:test`; Caddy 2 (`caddy:2-alpine`); GoatCounter 2.7.0; docker-compose 1.29; systemd 255; GitHub Actions.

Spec: `docs/superpowers/specs/2026-10-18-stats-page-design.md`.

## Global Constraints

- No runtime dependencies anywhere: exporter uses only the Python standard library; the page uses no libraries, no build step, no external URLs.
- Page CSP: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
- No inline `<script>` or `style=` in `page/`; scripts are same-origin `type="module"`.
- Sites, in this order: `rusinternet.com`, `wystore.ru`, `washguide.ru`. A path belongs to a site when it equals `/<host>` or starts with `/<host>/`.
- Periods: 7, 30, 90 days; default 30. Lists keep the top 10; the rest is one `"other"` entry (pages have no "other").
- Collected (shown on the page): for each view the page, time, referrer, country, browser language, browser, system (individual pageviews are stored; the page shows only the summary). Not collected: cookies, IP addresses, screen size, region. (Changed 2026-10-18 by the operator; Task 5c applies it.)
- Server: 192.144.58.198, root over `ssh -i "D:/hub/workspace/Infra/secrets/.ssh/wyvdsinaru" root@192.144.58.198`. Never print or copy keys or the API token.
- docker-compose 1.29 cannot recreate containers: apply compose changes with `docker-compose rm -sf <service> && docker-compose up -d`.
- edge-caddy has admin off: route changes need `docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` and then `docker restart edge-caddy` (about 2 s for all sites). If validate fails, put the old file back before any restart.
- Commits as `wyrtensi <wyrtensi@gmail.com>`, English messages, no Claude attribution, no emoji.
- Bots: only bot name and request count per site per day are kept (`/opt/stats/state/bots.json`, 90 days); never IPs, paths, User-Agent strings or log lines.
- GoatCounter API limits: 4 calls a second and 500 an hour per key; the exporter paces calls (0.3 s) and retries HTTP 429 up to 3 times.
- The API key lives only in `/etc/stats/token` (root, 0600); it is named `read_key` in GoatCounter and has only "Read statistics". Task 1 Step 1 is already done this way: the 2.7.0 CLI cannot grant that permission.
- Memory budget: stats-web `mem_limit: 32m`; goatcounter stays `96m`.

## File Structure

```
export/stats_export.py          exporter: API client, period builder, app block, atomic write, main()
export/tests/test_stats_export.py
export/tests/test_bots.py
export/tests/fixtures/*.json    recorded API responses (Task 1)
page/index.html                 shell: header, overview, details, collected block, footer
page/style.css                  neutral theme, light/dark tokens
page/i18n.js                    RU/EN strings, pickLang()
page/render.js                  pure functions: data -> HTML strings, SVG charts
page/app.js                     wiring: fetch JSON, switches, hash routing
page/favicon.svg
tests/page.test.mjs             render.js and i18n.js tests, static checks of index.html
tests/bots.test.mjs             people and bots rendering
deploy/server/docker-compose.yml   goatcounter (base path) + stats-web
deploy/server/Caddyfile            stats-web config (CSP, caching)
deploy/server/stats.wyrtensi.caddy edge route
deploy/server/stats-deploy.sh      forced command for the CI deploy key
deploy/server/stats-export.service
deploy/server/stats-export.timer
tests/deploy.test.mjs           forced-command and route checks
.github/workflows/site.yml      test, deploy page, smoke
.github/scripts/smoke.mjs
README.md
```

---

### Task 1: API token and recorded fixtures (server, no code)

**Files:**
- Create: `export/tests/fixtures/paths.json`, `total.json`, `hits.json`, `toprefs.json`, `locations.json`, `browsers.json`, `systems.json`, `releases.json`

**Interfaces:**
- Produces: `/etc/stats/token` on the server (0600, root, token only, no newline); fixture files with the real response shapes used by Tasks 2 and 3.

- [ ] **Step 1: Create the token without printing it**

```sh
ssh -i "D:/hub/workspace/Infra/secrets/.ssh/wyvdsinaru" root@192.144.58.198 '
set -e
install -d -m 700 /etc/stats
DB=sqlite+/home/goatcounter/goatcounter-data/db.sqlite3
docker exec goatcounter goatcounter db -db=$DB create apitoken -user 1 -name stats-export -perm stats >/dev/null
docker exec goatcounter goatcounter db -db=$DB query -format csv "select token from api_tokens where name = '"'"'stats-export'"'"'" \
  | tail -n 1 | tr -d "\r\n" > /etc/stats/token
chmod 600 /etc/stats/token
echo "token length: $(wc -c < /etc/stats/token)"'
```

Expected: `token length:` followed by a number above 20. If `-format csv` is rejected, run `docker exec goatcounter goatcounter db help query` and use its plain output with `tail -n 1`; still never print the token.

- [ ] **Step 2: Check the token reads statistics**

```sh
ssh ... 'curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $(cat /etc/stats/token)" http://$(docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" goatcounter):8080/api/v0/paths -H "Host: stats.wyrtensi.ru"'
```

Expected: `200`.

- [ ] **Step 3: Record fixtures**

Run on the server, saving each body to `/root/fixtures/`, then `scp` them into `export/tests/fixtures/`. `G` is the goatcounter address from Step 2; `A` is `-H "Authorization: Bearer $(cat /etc/stats/token)" -H "Host: stats.wyrtensi.ru"`.

```sh
curl -s $A "http://$G:8080/api/v0/paths?limit=200" > paths.json
IDS=$(python3 -c 'import json;print(",".join(str(p["id"]) for p in json.load(open("paths.json"))["paths"] if p["path"].startswith("/rusinternet.com")))')
S=$(date -u -d "-29 days" +%Y-%m-%dT00:00:00Z); E=$(date -u +%Y-%m-%dT%H:00:00Z)
curl -s $A "http://$G:8080/api/v0/stats/total?start=$S&end=$E&include_paths=$IDS" > total.json
curl -s $A "http://$G:8080/api/v0/stats/hits?start=$S&end=$E&include_paths=$IDS&limit=100" > hits.json
for p in toprefs locations browsers systems; do curl -s $A "http://$G:8080/api/v0/stats/$p?start=$S&end=$E&include_paths=$IDS&limit=100" > $p.json; done
curl -s "https://api.github.com/repos/wyrtensi/wystore/releases?per_page=100" > releases.json
```

Open each file and confirm the keys: `paths.json` has `paths[].{id,path,title}`; `total.json` has `total` and `stats[].{day,daily}`; `hits.json` has `hits[].{count,path,title}`; the four stats files have `stats[].{name,count}`. If any key differs, note it at the top of `export/tests/fixtures/README.md`; Tasks 2 and 3 use these files as the source of truth.

- [ ] **Step 4: Commit fixtures**

```bash
git add export/tests/fixtures
git commit -m "test: recorded GoatCounter and GitHub API responses"
```

---

### Task 2: Exporter core — site mapping, top-N, atomic write

**Files:**
- Create: `export/stats_export.py`
- Test: `export/tests/test_stats_export.py`

**Interfaces:**
- Produces:
  - `SITES: tuple[str, ...] = ("rusinternet.com", "wystore.ru", "washguide.ru")`
  - `site_of(path: str) -> tuple[str, str] | None` — `("wystore.ru", "/en/")` for `"/wystore.ru/en/"`, `("wystore.ru", "/")` for `"/wystore.ru"`, `None` otherwise.
  - `top(items: list[dict], n: int = 10) -> list[dict]` — items `{"name": str, "visits": int}` sorted by visits desc; beyond `n`, one `{"name": "other", "visits": sum}`.
  - `write_atomic(path: pathlib.Path, data: dict) -> None` — writes JSON (UTF-8, `ensure_ascii=False`, compact) to a temp file in the same directory, then `os.replace`.

- [ ] **Step 1: Write the failing tests**

```python
# export/tests/test_stats_export.py
import json, os, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import stats_export as se


class SiteOf(unittest.TestCase):
    def test_root_and_subpath(self):
        self.assertEqual(se.site_of("/wystore.ru"), ("wystore.ru", "/"))
        self.assertEqual(se.site_of("/wystore.ru/en/"), ("wystore.ru", "/en/"))
        self.assertEqual(se.site_of("/rusinternet.com/install/android/"), ("rusinternet.com", "/install/android/"))

    def test_other_paths(self):
        self.assertIsNone(se.site_of("/wystore.ruby/"))
        self.assertIsNone(se.site_of("/example.com/"))
        self.assertIsNone(se.site_of("/"))


class Top(unittest.TestCase):
    def test_sorted_and_other(self):
        items = [{"name": str(i), "visits": i} for i in range(1, 13)]
        out = se.top(items, 10)
        self.assertEqual([x["visits"] for x in out[:10]], list(range(12, 2, -1)))
        self.assertEqual(out[10], {"name": "other", "visits": 3})

    def test_no_other_when_short(self):
        self.assertEqual(se.top([{"name": "a", "visits": 1}], 10), [{"name": "a", "visits": 1}])


class WriteAtomic(unittest.TestCase):
    def test_writes_and_leaves_no_temp(self):
        with tempfile.TemporaryDirectory() as d:
            target = Path(d) / "30.json"
            se.write_atomic(target, {"a": "б"})
            self.assertEqual(json.loads(target.read_text("utf-8")), {"a": "б"})
            self.assertEqual(os.listdir(d), ["30.json"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to see them fail**

Run: `python -m unittest discover -s export/tests -v`
Expected: `ModuleNotFoundError: No module named 'stats_export'`.

- [ ] **Step 3: Implement**

```python
# export/stats_export.py
"""Exports aggregated GoatCounter statistics (and Wy Store release downloads)
to static JSON for the public page at stats.wyrtensi.ru. Standard library only;
runs on the server from stats-export.timer."""
import json
import os
import tempfile
from pathlib import Path

SITES = ("rusinternet.com", "wystore.ru", "washguide.ru")


def site_of(path):
    """Split a counter path "/<host>/rest" into (host, "/rest")."""
    for host in SITES:
        prefix = "/" + host
        if path == prefix:
            return host, "/"
        if path.startswith(prefix + "/"):
            return host, path[len(prefix):]
    return None


def top(items, n=10):
    """Top n by visits; the rest summed into one "other" entry."""
    ranked = sorted(items, key=lambda x: x["visits"], reverse=True)
    if len(ranked) <= n:
        return ranked
    return ranked[:n] + [{"name": "other", "visits": sum(x["visits"] for x in ranked[n:])}]


def write_atomic(path, data):
    path = Path(path)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
```

- [ ] **Step 4: Run the tests**

Run: `python -m unittest discover -s export/tests -v`
Expected: 6 tests, `OK`.

- [ ] **Step 5: Commit**

```bash
git add export/stats_export.py export/tests/test_stats_export.py
git commit -m "feat(export): site mapping, top-N and atomic JSON writes"
```

---

### Task 3: Exporter — periods, app block, main()

**Files:**
- Modify: `export/stats_export.py`
- Test: `export/tests/test_stats_export.py`

**Interfaces:**
- Consumes: `SITES`, `site_of`, `top`, `write_atomic` (Task 2); fixtures (Task 1).
- Produces:
  - `class Api(base: str, token: str, host: str | None = None)` with `get(path: str, params: dict) -> dict` (GET `base + path`, header `Authorization: Bearer <token>`, plus `Host: <host>` when `host` is given — needed only when calling the container by address).
  - `build_period(api, days: int, now: datetime) -> dict` — the period file without `app` (keys `generated`, `period`, `collected`, `sites`).
  - `build_app(releases: list[dict], fetched: str) -> dict` — the `app` block.
  - `fetch_releases(opener=urllib.request.urlopen) -> list[dict]` — all pages of `https://api.github.com/repos/wyrtensi/wystore/releases?per_page=100&page=N`.
  - `main(argv: list[str]) -> int` — `stats-export --out /opt/stats/page/data --base https://stats.wyrtensi.ru/admin --token-file /etc/stats/token [--host stats.wyrtensi.ru]`.

- [ ] **Step 1: Write the failing tests**

Append to `export/tests/test_stats_export.py` (above `if __name__`):

```python
from datetime import datetime, timezone

FIX = Path(__file__).resolve().parent / "fixtures"


def fixture(name):
    return json.loads((FIX / name).read_text("utf-8"))


class FakeApi:
    """Answers like the recorded API; every site gets the same numbers."""
    def __init__(self):
        self.calls = []

    def get(self, path, params):
        self.calls.append((path, dict(params)))
        name = {"/api/v0/paths": "paths.json", "/api/v0/stats/total": "total.json",
                "/api/v0/stats/hits": "hits.json"}.get(path)
        if name is None:
            name = path.rsplit("/", 1)[1] + ".json"
        return fixture(name)


NOW = datetime(2026, 10, 18, 16, 7, tzinfo=timezone.utc)


class BuildPeriod(unittest.TestCase):
    def test_shape_and_sites(self):
        out = se.build_period(FakeApi(), 30, NOW)
        self.assertEqual(out["generated"], "2026-10-18T16:07:00Z")
        self.assertEqual(out["period"], {"days": 30, "start": "2026-09-19", "end": "2026-10-18"})
        self.assertEqual(out["collected"], ["page", "referrer", "country", "browser", "system"])
        self.assertEqual([s["host"] for s in out["sites"]], list(se.SITES))
        site = out["sites"][0]
        for key in ("visits", "daily", "pages", "referrers", "countries", "browsers", "systems"):
            self.assertIn(key, site)
        self.assertTrue(all(not p["path"].startswith("/rusinternet.com") for p in site["pages"]))

    def test_filters_by_site_paths(self):
        api = FakeApi()
        se.build_period(api, 7, NOW)
        ids = {p["id"] for p in fixture("paths.json")["paths"] if (se.site_of(p["path"]) or ("",))[0] == "rusinternet.com"}
        total_calls = [c for c in api.calls if c[0] == "/api/v0/stats/total"]
        self.assertEqual(set(int(i) for i in total_calls[0][1]["include_paths"].split(",")), ids)
        self.assertEqual(total_calls[0][1]["start"], "2026-10-12T00:00:00Z")
        self.assertEqual(total_calls[0][1]["end"], "2026-10-18T16:00:00Z")

    def test_site_without_paths_is_empty(self):
        class NoPaths(FakeApi):
            def get(self, path, params):
                if path == "/api/v0/paths":
                    return {"paths": [], "more": False}
                raise AssertionError("no stats calls expected")
        out = se.build_period(NoPaths(), 30, NOW)
        self.assertEqual(out["sites"][1], {"host": "wystore.ru", "visits": 0, "daily": [], "pages": [],
                                           "referrers": [], "countries": [], "browsers": [], "systems": []})


def release(tag, published, apk, other=0, draft=False, pre=False):
    assets = [{"name": "wystore.apk", "download_count": apk}]
    if other:
        assets.append({"name": "wystore.apk.sha256", "download_count": other})
    return {"tag_name": tag, "published_at": published, "draft": draft, "prerelease": pre,
            "html_url": f"https://github.com/wyrtensi/wystore/releases/tag/{tag}", "assets": assets}


class BuildApp(unittest.TestCase):
    def test_latest_and_totals(self):
        rels = [release("v0.4.1", "2026-10-18T00:20:00Z", 33, other=5),
                release("v0.5.0-beta", "2026-10-19T00:00:00Z", 7, pre=True),
                release("v0.4.0", "2026-10-01T10:00:00Z", 100)]
        app = se.build_app(rels, "2026-10-18T16:07:00Z")
        self.assertEqual(app["latest"], {"version": "v0.4.1", "published": "2026-10-18", "downloads": 33,
                                         "url": "https://github.com/wyrtensi/wystore/releases/tag/v0.4.1"})
        self.assertEqual(app["total_downloads"], 133)
        self.assertEqual(app["releases"], 2)
        self.assertEqual(app["fetched"], "2026-10-18T16:07:00Z")

    def test_newer_release_becomes_latest(self):
        rels = [release("v0.4.1", "2026-10-18T00:20:00Z", 33), release("v0.4.2", "2026-10-25T09:00:00Z", 2)]
        self.assertEqual(se.build_app(rels, "x")["latest"]["version"], "v0.4.2")

    def test_recorded_releases(self):
        app = se.build_app(fixture("releases.json"), "x")
        self.assertTrue(app["latest"]["version"].startswith("v"))
        self.assertGreaterEqual(app["total_downloads"], app["latest"]["downloads"])


class Main(unittest.TestCase):
    def run_main(self, out, api, releases):
        return se.run(out, api, releases, NOW)

    def test_writes_three_files_with_app(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(self.run_main(Path(d), FakeApi(), lambda: fixture("releases.json")), 0)
            self.assertEqual(sorted(os.listdir(d)), ["30.json", "7.json", "90.json"])
            data = json.loads((Path(d) / "30.json").read_text("utf-8"))
            self.assertEqual(data["app"]["site"], "wystore.ru")

    def test_api_failure_keeps_old_files(self):
        class Broken(FakeApi):
            def get(self, path, params):
                raise OSError("connection refused")
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "30.json").write_text('{"old": true}', "utf-8")
            self.assertEqual(self.run_main(Path(d), Broken(), lambda: []), 1)
            self.assertEqual((Path(d) / "30.json").read_text("utf-8"), '{"old": true}')

    def test_github_failure_keeps_previous_app(self):
        def no_github():
            raise OSError("rate limited")
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "30.json").write_text(json.dumps({"app": {"site": "wystore.ru", "fetched": "old"}}), "utf-8")
            self.assertEqual(self.run_main(Path(d), FakeApi(), no_github), 0)
            data = json.loads((Path(d) / "7.json").read_text("utf-8"))
            self.assertEqual(data["app"], {"site": "wystore.ru", "fetched": "old"})
```

- [ ] **Step 2: Run to see them fail**

Run: `python -m unittest discover -s export/tests -v`
Expected: `AttributeError: module 'stats_export' has no attribute 'build_period'` (and `build_app`, `run`).

- [ ] **Step 3: Implement**

Append to `export/stats_export.py`:

```python
import argparse
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

PERIODS = (7, 30, 90)
COLLECTED = ["page", "referrer", "country", "browser", "system"]
BREAKDOWNS = {"referrers": "toprefs", "countries": "locations", "browsers": "browsers", "systems": "systems"}
RELEASES_URL = "https://api.github.com/repos/wyrtensi/wystore/releases?per_page=100&page={page}"


class Api:
    def __init__(self, base, token, host=None):
        self.base, self.token, self.host = base.rstrip("/"), token, host

    def get(self, path, params):
        url = self.base + path + ("?" + urllib.parse.urlencode(params) if params else "")
        headers = {"Authorization": "Bearer " + self.token, "User-Agent": "stats-export"}
        if self.host:
            headers["Host"] = self.host
        req = urllib.request.Request(url, headers=headers)
        # GoatCounter allows 4 API calls a second and 500 an hour per key; one
        # run makes about 55. Pace the calls and retry a 429 a few times.
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    body = json.load(r)
                time.sleep(0.3)
                return body
            except urllib.error.HTTPError as err:
                if err.code != 429 or attempt == 3:
                    raise
                time.sleep(2 * (attempt + 1))


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def site_paths(api):
    """{host: [path dicts]} for all counter paths, following pagination."""
    by_site, after = {h: [] for h in SITES}, 0
    while True:
        page = api.get("/api/v0/paths", {"limit": 200, "after": after})
        for p in page["paths"]:
            hit = site_of(p["path"])
            if hit:
                by_site[hit[0]].append(p)
        if not page.get("more") or not page["paths"]:
            return by_site
        after = page["paths"][-1]["id"]


def empty_site(host):
    return {"host": host, "visits": 0, "daily": [], "pages": [],
            "referrers": [], "countries": [], "browsers": [], "systems": []}


def build_site(api, host, paths, start, end):
    if not paths:
        return empty_site(host)
    base = {"start": iso(start), "end": iso(end), "include_paths": ",".join(str(p["id"]) for p in paths)}
    total = api.get("/api/v0/stats/total", base)
    hits = api.get("/api/v0/stats/hits", {**base, "limit": 100})
    pages = [{"path": site_of(h["path"])[1], "title": h.get("title", ""), "visits": h["count"]}
             for h in hits["hits"] if site_of(h["path"])]
    site = {"host": host, "visits": total["total"],
            "daily": [{"day": s["day"], "visits": s["daily"]} for s in total.get("stats", [])],
            "pages": sorted(pages, key=lambda x: x["visits"], reverse=True)[:10]}
    for key, endpoint in BREAKDOWNS.items():
        stats = api.get("/api/v0/stats/" + endpoint, {**base, "limit": 100})["stats"]
        site[key] = top([{"name": s["name"] or "unknown", "visits": s["count"]} for s in stats])
    return site


def build_period(api, days, now):
    end = now.replace(minute=0, second=0, microsecond=0)
    start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    by_site = site_paths(api)
    return {"generated": iso(now.replace(second=0, microsecond=0)),
            "period": {"days": days, "start": start.strftime("%Y-%m-%d"), "end": now.strftime("%Y-%m-%d")},
            "collected": COLLECTED,
            "sites": [build_site(api, h, by_site[h], start, end) for h in SITES]}


def apk_downloads(rel):
    return sum(a["download_count"] for a in rel["assets"] if a["name"].endswith(".apk"))


def build_app(releases, fetched):
    published = [r for r in releases if not r["draft"] and not r["prerelease"]]
    published.sort(key=lambda r: r["published_at"], reverse=True)
    latest = published[0] if published else None
    return {"site": "wystore.ru", "repo": "wyrtensi/wystore",
            "latest": latest and {"version": latest["tag_name"], "published": latest["published_at"][:10],
                                  "downloads": apk_downloads(latest), "url": latest["html_url"]},
            "total_downloads": sum(apk_downloads(r) for r in published),
            "releases": len(published), "fetched": fetched}


def fetch_releases(opener=urllib.request.urlopen):
    releases, page = [], 1
    while True:
        req = urllib.request.Request(RELEASES_URL.format(page=page), headers={"Accept": "application/vnd.github+json",
                                                                              "User-Agent": "stats.wyrtensi.ru"})
        with opener(req, timeout=20) as r:
            batch = json.load(r)
        releases += batch
        if len(batch) < 100:
            return releases
        page += 1


def previous_app(out):
    try:
        return json.loads((out / "30.json").read_text("utf-8")).get("app")
    except (OSError, ValueError):
        return None


def run(out, api, releases, now):
    """Build all periods first; write only if every GoatCounter call succeeded."""
    try:
        files = {days: build_period(api, days, now) for days in PERIODS}
    except (OSError, ValueError, KeyError) as err:
        print(f"stats-export: GoatCounter failed, old files kept: {err}", file=sys.stderr)
        return 1
    try:
        app = build_app(releases(), iso(now.replace(second=0, microsecond=0)))
    except (OSError, ValueError, KeyError) as err:
        print(f"stats-export: GitHub failed, previous app block kept: {err}", file=sys.stderr)
        app = previous_app(out)
    for days, data in files.items():
        data["app"] = app
        write_atomic(out / f"{days}.json", data)
    return 0


def main(argv):
    parser = argparse.ArgumentParser(prog="stats-export")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--host", default=None, help="Host header, only when --base is a container address")
    args = parser.parse_args(argv)
    api = Api(args.base, args.token_file.read_text("utf-8").strip(), args.host)
    return run(args.out, api, fetch_releases, datetime.now(timezone.utc))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

Move the new imports to the top of the file next to the existing ones.

- [ ] **Step 4: Run the tests**

Run: `python -m unittest discover -s export/tests -v`
Expected: all tests `OK`. If `test_shape_and_sites` fails on a key name, compare with the fixture (Task 1, Step 3) and fix `build_site`, not the test.

- [ ] **Step 5: Commit**

```bash
git add export/stats_export.py export/tests/test_stats_export.py
git commit -m "feat(export): period files from GoatCounter and Wy Store downloads from GitHub"
```

---

### Task 3b: Exporter — bots from the edge access logs

**Files:**
- Modify: `export/stats_export.py`
- Test: `export/tests/test_bots.py`

**Interfaces:**
- Consumes: `SITES`, `top`, `write_atomic`, `run` (Tasks 2–3).
- Produces:
  - `BOTS: list[tuple[str, str, str]]` — `(name, category, lowercase substring)`, first match wins.
  - `classify(ua: str) -> tuple[str, str] | None` — `("YandexBot", "search")`, `("other bots", "other")`, or `None` for people.
  - `parse_line(line: str) -> tuple[str, str, str, str] | None` — `(timestamp, day, host, ua)` from a `docker logs --timestamps` line, or `None`.
  - `update_bots(state: dict, lines: list[str], today: date) -> dict` — state `{"last": str | None, "days": {day: {host: {bot: count}}}}`.
  - `bots_for_period(state: dict, days: int, now: datetime) -> dict[str, dict]` — `{host: {"requests": int, "list": [{"name", "category", "visits"}]}}` for every site in `SITES`.
  - `read_log_lines(since: str | None) -> list[str]` — runs `docker logs --timestamps --since <since or 10m> edge-caddy`, stderr merged.
  - `run(out, api, releases, now, state_path=None, read_logs=read_log_lines) -> int` — as before, plus `site["bots"]` in every period file; bot failures never fail the run.

- [ ] **Step 1: Write the failing tests**

```python
# export/tests/test_bots.py
import json, sys, tempfile, unittest
from datetime import date, datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import stats_export as se
from test_stats_export import FakeApi, fixture

TS = "2026-10-18T16:07:01.123456789Z"


def console(host, ua, ts=TS):
    body = {"request": {"remote_ip": "203.0.113.5", "host": host, "uri": "/", "headers": {"User-Agent": [ua]}}, "status": 200}
    return f"{ts} 2026/10/18 16:07:01.123\tINFO\thttp.log.access.log0\thandled request\t{json.dumps(body)}"


def jsonline(host, ua, ts=TS):
    body = {"level": "info", "logger": "http.log.access", "msg": "handled request",
            "request": {"remote_ip": "203.0.113.5", "host": host, "headers": {"User-Agent": [ua]}}, "status": 308}
    return f"{ts} {json.dumps(body)}"


class Classify(unittest.TestCase):
    def test_known_bots(self):
        self.assertEqual(se.classify("Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)"), ("YandexBot", "search"))
        self.assertEqual(se.classify("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2)"), ("GPTBot", "ai"))
        self.assertEqual(se.classify("Mozilla/5.0 (compatible; Claude-SearchBot/1.0)"), ("Claude-SearchBot", "ai"))
        self.assertEqual(se.classify("Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)"), ("ClaudeBot", "ai"))

    def test_generic_and_people(self):
        self.assertEqual(se.classify("CGMSearchBot/1.0"), ("other bots", "other"))
        self.assertEqual(se.classify("curl/8.5.0"), ("other bots", "other"))
        self.assertEqual(se.classify(""), ("other bots", "other"))
        self.assertIsNone(se.classify("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36"))


class ParseLine(unittest.TestCase):
    def test_both_formats(self):
        self.assertEqual(se.parse_line(console("washguide.ru", "GPTBot/1.2")), (TS, "2026-10-18", "washguide.ru", "GPTBot/1.2"))
        self.assertEqual(se.parse_line(jsonline("wystore.ru", "x")), (TS, "2026-10-18", "wystore.ru", "x"))

    def test_noise(self):
        self.assertIsNone(se.parse_line(f"{TS} 2026/10/18 INFO tls.obtain certificate obtained"))
        self.assertIsNone(se.parse_line("garbage"))


class UpdateBots(unittest.TestCase):
    def test_counts_only_our_sites_and_bots(self):
        lines = [console("washguide.ru", "GPTBot/1.2"), console("washguide.ru", "GPTBot/1.2"),
                 console("www.washguide.ru", "GPTBot/1.2"), console("example.shop", "GPTBot/1.2"),
                 console("rusinternet.com", "Mozilla/5.0 Chrome/141.0")]
        state = se.update_bots({"last": None, "days": {}}, lines, date(2026, 10, 18))
        self.assertEqual(state["days"], {"2026-10-18": {"washguide.ru": {"GPTBot": 2}}})
        self.assertEqual(state["last"], TS)

    def test_skips_lines_already_seen(self):
        state = {"last": TS, "days": {}}
        later = "2026-10-18T16:09:00.000000000Z"
        state = se.update_bots(state, [console("wystore.ru", "bingbot"), console("wystore.ru", "bingbot", later)], date(2026, 10, 18))
        self.assertEqual(state["days"]["2026-10-18"]["wystore.ru"], {"bingbot": 1})
        self.assertEqual(state["last"], later)

    def test_drops_days_older_than_90(self):
        state = {"last": None, "days": {"2026-07-01": {"wystore.ru": {"bingbot": 3}}}}
        self.assertNotIn("2026-07-01", se.update_bots(state, [], date(2026, 10, 18))["days"])

    def test_keeps_no_ip_or_user_agent(self):
        state = se.update_bots({"last": None, "days": {}}, [console("washguide.ru", "GPTBot/1.2")], date(2026, 10, 18))
        dumped = json.dumps(state)
        self.assertNotIn("203.0.113.5", dumped)
        self.assertNotIn("GPTBot/1.2", dumped)


class BotsForPeriod(unittest.TestCase):
    def test_window_and_shape(self):
        state = {"last": None, "days": {"2026-10-18": {"washguide.ru": {"GPTBot": 2, "YandexBot": 5}},
                                        "2026-10-01": {"washguide.ru": {"GPTBot": 100}}}}
        out = se.bots_for_period(state, 7, datetime(2026, 10, 18, 16, 7, tzinfo=timezone.utc))
        self.assertEqual(out["washguide.ru"], {"requests": 7, "list": [
            {"name": "YandexBot", "category": "search", "visits": 5}, {"name": "GPTBot", "category": "ai", "visits": 2}]})
        self.assertEqual(out["wystore.ru"], {"requests": 0, "list": []})


class RunWithBots(unittest.TestCase):
    def test_bots_in_files_and_state_saved(self):
        with tempfile.TemporaryDirectory() as d:
            out, state = Path(d), Path(d) / "bots.json"
            code = se.run(out, FakeApi(), lambda: fixture("releases.json"),
                          datetime(2026, 10, 18, 16, 7, tzinfo=timezone.utc), state,
                          lambda since: [console("washguide.ru", "GPTBot/1.2")])
            self.assertEqual(code, 0)
            data = json.loads((out / "7.json").read_text("utf-8"))
            site = next(s for s in data["sites"] if s["host"] == "washguide.ru")
            self.assertEqual(site["bots"]["requests"], 1)
            self.assertEqual(json.loads(state.read_text("utf-8"))["last"], TS)

    def test_log_failure_keeps_state_and_still_exports(self):
        def broken(since):
            raise OSError("docker not reachable")
        with tempfile.TemporaryDirectory() as d:
            out, state = Path(d), Path(d) / "bots.json"
            state.write_text(json.dumps({"last": TS, "days": {"2026-10-18": {"wystore.ru": {"bingbot": 4}}}}), "utf-8")
            code = se.run(out, FakeApi(), lambda: [], datetime(2026, 10, 18, 16, 7, tzinfo=timezone.utc), state, broken)
            self.assertEqual(code, 0)
            data = json.loads((out / "7.json").read_text("utf-8"))
            self.assertEqual(next(s for s in data["sites"] if s["host"] == "wystore.ru")["bots"]["requests"], 4)
```

- [ ] **Step 2: Run to see them fail**

Run: `python -m unittest discover -s export/tests -v`
Expected: `AttributeError: module 'stats_export' has no attribute 'classify'`.

- [ ] **Step 3: Implement**

Add `import re`, `import subprocess` to the imports at the top of `export/stats_export.py`, then add:

```python
# Known bots: (name, category, lowercase substring); first match wins, so the
# more specific names come first.
BOTS = [
    ("Claude-SearchBot", "ai", "claude-searchbot"), ("Claude-User", "ai", "claude-user"), ("ClaudeBot", "ai", "claudebot"),
    ("OAI-SearchBot", "ai", "oai-searchbot"), ("ChatGPT-User", "ai", "chatgpt-user"), ("GPTBot", "ai", "gptbot"),
    ("Perplexity-User", "ai", "perplexity-user"), ("PerplexityBot", "ai", "perplexitybot"),
    ("YandexAdditional", "ai", "yandexadditional"), ("CCBot", "ai", "ccbot"), ("Bytespider", "ai", "bytespider"),
    ("meta-externalagent", "ai", "meta-externalagent"), ("Amazonbot", "ai", "amazonbot"),
    ("Googlebot", "search", "googlebot"), ("YandexBot", "search", "yandex"), ("bingbot", "search", "bingbot"),
    ("DuckDuckBot", "search", "duckduckbot"), ("Applebot", "search", "applebot"),
    ("Baiduspider", "search", "baiduspider"), ("PetalBot", "search", "petalbot"),
]
CATEGORY = {name: category for name, category, _ in BOTS} | {"other bots": "other"}
GENERIC_BOT = re.compile(r"bot|crawl|spider|slurp|scan|curl|wget|python|go-http-client|headless", re.I)
KEEP_DAYS = 90


def classify(ua):
    low = (ua or "").lower()
    for name, category, needle in BOTS:
        if needle in low:
            return name, category
    if not low or GENERIC_BOT.search(low):
        return "other bots", "other"
    return None


def parse_line(line):
    """(timestamp, day, host, ua) from a `docker logs --timestamps` access line."""
    ts, _, rest = line.partition(" ")
    if len(ts) < 20 or ts[4] != "-":
        return None
    start = 0 if rest.startswith("{") else rest.find('{"request"')
    if start < 0:
        return None
    try:
        body = json.loads(rest[start:])
    except ValueError:
        return None
    req = body.get("request") if isinstance(body, dict) else None
    if not isinstance(req, dict) or "host" not in req:
        return None
    ua = (req.get("headers", {}).get("User-Agent") or [""])[0]
    return ts, ts[:10], req["host"], ua


def update_bots(state, lines, today):
    """Add bot requests from new log lines; keep only names and counts."""
    last = state.get("last")
    newest = last
    days = state.get("days", {})
    for line in lines:
        parsed = parse_line(line)
        if not parsed:
            continue
        ts, day, host, ua = parsed
        if last and ts <= last:
            continue
        if newest is None or ts > newest:
            newest = ts
        bot = classify(ua) if host in SITES else None
        if bot:
            per_site = days.setdefault(day, {}).setdefault(host, {})
            per_site[bot[0]] = per_site.get(bot[0], 0) + 1
    cutoff = (today - timedelta(days=KEEP_DAYS)).isoformat()
    return {"last": newest, "days": {d: v for d, v in days.items() if d >= cutoff}}


def bots_for_period(state, days, now):
    first = (now - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    out = {}
    for host in SITES:
        counts = {}
        for day, per_site in state.get("days", {}).items():
            if day >= first:
                for name, n in per_site.get(host, {}).items():
                    counts[name] = counts.get(name, 0) + n
        ranked = top([{"name": n, "visits": v} for n, v in counts.items()])
        out[host] = {"requests": sum(counts.values()),
                     "list": [{"name": x["name"], "category": CATEGORY.get(x["name"], "other"), "visits": x["visits"]}
                              for x in ranked]}
    return out


def read_log_lines(since):
    cmd = ["docker", "logs", "--timestamps", "--since", since or "10m", "edge-caddy"]
    done = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, check=True, timeout=60)
    return done.stdout.splitlines()


def load_state(path):
    try:
        return json.loads(Path(path).read_text("utf-8"))
    except (OSError, ValueError):
        return {"last": None, "days": {}}
```

Replace `run` with:

```python
def run(out, api, releases, now, state_path=None, read_logs=read_log_lines):
    """Build all periods first; write only if every GoatCounter call succeeded.
    GitHub and bot-log failures keep their previous data instead of failing."""
    try:
        files = {days: build_period(api, days, now) for days in PERIODS}
    except (OSError, ValueError, KeyError) as err:
        print(f"stats-export: GoatCounter failed, old files kept: {err}", file=sys.stderr)
        return 1
    try:
        app = build_app(releases(), iso(now.replace(second=0, microsecond=0)))
    except (OSError, ValueError, KeyError) as err:
        print(f"stats-export: GitHub failed, previous app block kept: {err}", file=sys.stderr)
        app = previous_app(out)
    state = load_state(state_path) if state_path else {"last": None, "days": {}}
    if state_path:
        try:
            state = update_bots(state, read_logs(state.get("last")), now.date())
            write_atomic(state_path, state)
        except (OSError, ValueError, subprocess.SubprocessError) as err:
            print(f"stats-export: reading edge logs failed, bot counts kept: {err}", file=sys.stderr)
    for days, data in files.items():
        bots = bots_for_period(state, days, now)
        for site in data["sites"]:
            site["bots"] = bots[site["host"]]
        data["app"] = app
        write_atomic(out / f"{days}.json", data)
    return 0
```

In `main`, add `parser.add_argument("--state", type=Path, default=None)` and call `run(args.out, api, fetch_releases, datetime.now(timezone.utc), args.state)`.

In Task 3's `Main.test_writes_three_files_with_app`, the directory listing is still exactly `["30.json", "7.json", "90.json"]` because those tests pass no `state_path`.

- [ ] **Step 4: Run all exporter tests**

Run: `python -m unittest discover -s export/tests -v`
Expected: all `OK`.

- [ ] **Step 5: Commit**

```bash
git add export/stats_export.py export/tests/test_bots.py
git commit -m "feat(export): count bot requests per site from the edge access logs"
```

---

### Task 4: Page logic — i18n and render functions

**Files:**
- Create: `page/i18n.js`, `page/render.js`
- Test: `tests/page.test.mjs`, `tests/sample.json`

**Interfaces:**
- Consumes: the data file shape from Task 3.
- Produces:
  - `i18n.js`: `export const T = { ru: {...}, en: {...} }`; `export function pickLang(navLang: string, saved: string | null): 'ru' | 'en'`.
  - `render.js`: `export function fmt(n: number, lang): string`; `export function sparkline(daily, w = 120, h = 28): string` (SVG); `export function bars(daily, w = 640, h = 140): string` (SVG); `export function overview(data, lang): string`; `export function details(site, app, lang): string`; `export function appBlock(app, lang): string`; `export function collected(lang): string`; `export function updated(generated: string, now: Date, lang): string`. All return HTML strings with every data value escaped by `esc()`.

- [ ] **Step 1: Write the failing tests**

`tests/sample.json` — a minimal valid file:

```json
{"generated":"2026-10-18T16:07:00Z","period":{"days":7,"start":"2026-10-12","end":"2026-10-18"},
 "collected":["page","referrer","country","browser","system"],
 "sites":[
  {"host":"rusinternet.com","visits":12,"daily":[{"day":"2026-10-17","visits":5},{"day":"2026-10-18","visits":7}],
   "pages":[{"path":"/install/android/","title":"<b>Android</b>","visits":9}],
   "referrers":[{"name":"yandex.ru","visits":4}],"countries":[{"name":"Russia","visits":12}],
   "browsers":[{"name":"Chrome","visits":10},{"name":"other","visits":2}],"systems":[{"name":"Android","visits":8}]},
  {"host":"wystore.ru","visits":0,"daily":[],"pages":[],"referrers":[],"countries":[],"browsers":[],"systems":[]},
  {"host":"washguide.ru","visits":3,"daily":[{"day":"2026-10-18","visits":3}],"pages":[],"referrers":[],"countries":[],"browsers":[],"systems":[]}],
 "app":{"site":"wystore.ru","repo":"wyrtensi/wystore","latest":{"version":"v0.4.1","published":"2026-10-18","downloads":33,
   "url":"https://github.com/wyrtensi/wystore/releases/tag/v0.4.1"},"total_downloads":812,"releases":30,"fetched":"2026-10-18T16:07:00Z"}}
```

`tests/page.test.mjs`:

```js
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
  for (const k of ['pages', 'referrers', 'countries', 'browsers', 'systems']) assert.ok(html.includes(T.en[k]), k);
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
  for (const k of ['cPage', 'cReferrer', 'cCountry', 'cBrowser', 'cSystem', 'nCookies', 'nIp', 'nSize', 'nLanguage', 'nVisits'])
    assert.ok(html.includes(T.en[k]), k);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test tests/`
Expected: `Cannot find module '../page/i18n.js'`.

- [ ] **Step 3: Implement `page/i18n.js`**

```js
// Interface strings. Russian for ru and its neighbours, English for the rest.
export const T = {
  ru: {
    title: 'Статистика', lead: 'Сколько людей заходит на наши сайты. Без cookie и без IP-адресов — только то, что видно ниже.',
    days: 'дн.', visits: 'визитов', pages: 'Страницы', referrers: 'Откуда пришли', countries: 'Страны',
    browsers: 'Браузеры', systems: 'Системы', other: 'остальное', unknown: 'неизвестно', noData: 'Пока нет данных за этот период.',
    app: 'Приложение Wy Store', latest: 'Последняя версия', latestDownloads: 'Скачиваний версии',
    totalDownloads: 'Скачиваний всего', allTime: 'за всё время, по данным GitHub', releases: 'релизов',
    collectedTitle: 'Что мы собираем', keptTitle: 'Сохраняется', notKeptTitle: 'Не сохраняется',
    cPage: 'страница', cReferrer: 'источник перехода', cCountry: 'страна', cBrowser: 'браузер', cSystem: 'система',
    nCookies: 'cookie', nIp: 'IP-адреса', nSize: 'размер экрана', nLanguage: 'язык', nVisits: 'отдельные визиты',
    counterNote: 'Счётчик — GoatCounter на нашем сервере.', source: 'Исходный код страницы',
    updated: 'Обновлено', stale: 'данные могут быть устаревшими', back: '← Все сайты', theme: 'Тема', lang: 'English'
  },
  en: {
    title: 'Stats', lead: 'How many people visit our sites. No cookies and no IP addresses — only what you see below.',
    days: 'days', visits: 'visits', pages: 'Pages', referrers: 'Referrers', countries: 'Countries',
    browsers: 'Browsers', systems: 'Systems', other: 'other', unknown: 'unknown', noData: 'No data for this period yet.',
    app: 'Wy Store app', latest: 'Latest version', latestDownloads: 'Downloads of this version',
    totalDownloads: 'Downloads in total', allTime: 'all time, from GitHub', releases: 'releases',
    collectedTitle: 'What we collect', keptTitle: 'Kept', notKeptTitle: 'Not kept',
    cPage: 'page', cReferrer: 'referrer', cCountry: 'country', cBrowser: 'browser', cSystem: 'system',
    nCookies: 'cookies', nIp: 'IP addresses', nSize: 'screen size', nLanguage: 'language', nVisits: 'individual visits',
    counterNote: 'The counter is GoatCounter on our own server.', source: 'Source code of this page',
    updated: 'Updated', stale: 'the data may be stale', back: '← All sites', theme: 'Theme', lang: 'Русский'
  }
};

const RU_FAMILY = ['ru', 'uk', 'be', 'kk', 'uz'];

export function pickLang(navLang, saved) {
  if (saved === 'ru' || saved === 'en') return saved;
  return RU_FAMILY.includes(String(navLang || '').slice(0, 2).toLowerCase()) ? 'ru' : 'en';
}
```

- [ ] **Step 4: Implement `page/render.js`**

```js
// Pure rendering: data in, HTML strings out. No DOM access, so it is testable in Node.
import { T } from './i18n.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const fmt = (n, lang) => new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US').format(n);

export function sparkline(daily, w = 120, h = 28) {
  if (!daily.length) return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
  const max = Math.max(1, ...daily.map((d) => d.visits));
  const step = daily.length > 1 ? w / (daily.length - 1) : 0;
  const pts = daily.map((d, i) => `${(i * step).toFixed(1)},${(h - 2 - (d.visits / max) * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

export function bars(daily, w = 640, h = 140) {
  const max = Math.max(1, ...daily.map((d) => d.visits));
  const bw = daily.length ? w / daily.length : w;
  const rects = daily.map((d, i) => {
    const bh = (d.visits / max) * (h - 16);
    return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${bh.toFixed(1)}"><title>${esc(d.day)}: ${d.visits}</title></rect>`;
  }).join('');
  return `<svg class="bars" viewBox="0 0 ${w} ${h}" role="img">${rects}</svg>`;
}

function list(title, items, lang, label = (x) => x.name) {
  if (!items.length) return '';
  const max = Math.max(1, ...items.map((x) => x.visits));
  const rows = items.map((x) => {
    const name = x.name === 'other' ? T[lang].other : (label(x) || T[lang].unknown);
    return `<li><span class="bar" data-w="${Math.round((x.visits / max) * 100)}"></span><span class="name">${esc(name)}</span><span class="num">${fmt(x.visits, lang)}</span></li>`;
  }).join('');
  return `<section class="list"><h3>${esc(title)}</h3><ol>${rows}</ol></section>`;
}

export function overview(data, lang) {
  const t = T[lang];
  return data.sites.map((s) => `<a class="card" href="#${esc(s.host)}" data-site="${esc(s.host)}">
  <span class="host">${esc(s.host)}</span>
  <span class="big">${fmt(s.visits, lang)}</span><span class="unit">${t.visits}</span>
  ${sparkline(s.daily)}
</a>`).join('');
}

export function appBlock(app, lang) {
  const t = T[lang];
  if (!app || !app.latest) return '';
  return `<section class="app"><h3>${t.app}</h3><dl>
  <div><dt>${t.latest}</dt><dd><a href="${esc(app.latest.url)}">${esc(app.latest.version)}</a> <small>${esc(app.latest.published)}</small></dd></div>
  <div><dt>${t.latestDownloads}</dt><dd>${fmt(app.latest.downloads, lang)}</dd></div>
  <div><dt>${t.totalDownloads}</dt><dd>${fmt(app.total_downloads, lang)} <small>${t.allTime} · ${fmt(app.releases, lang)} ${t.releases}</small></dd></div>
</dl></section>`;
}

export function details(site, app, lang) {
  const t = T[lang];
  const head = `<a class="back" href="#">${t.back}</a><h2>${esc(site.host)}</h2>`;
  const appHtml = app && app.site === site.host ? appBlock(app, lang) : '';
  if (!site.visits) return `${head}${appHtml}<p class="empty">${t.noData}</p>`;
  return `${head}<p class="total"><span class="big">${fmt(site.visits, lang)}</span> ${t.visits}</p>
${bars(site.daily)}
${appHtml}
<div class="lists">
${list(t.pages, site.pages.map((p) => ({ ...p, name: p.path })), lang, (p) => p.title ? `${p.path} — ${p.title}` : p.path)}
${list(t.referrers, site.referrers, lang)}
${list(t.countries, site.countries, lang)}
${list(t.browsers, site.browsers, lang)}
${list(t.systems, site.systems, lang)}
</div>`;
}

export function collected(lang) {
  const t = T[lang];
  const li = (keys) => keys.map((k) => `<li>${t[k]}</li>`).join('');
  return `<h2>${t.collectedTitle}</h2>
<div class="cols"><div><h3>${t.keptTitle}</h3><ul class="yes">${li(['cPage', 'cReferrer', 'cCountry', 'cBrowser', 'cSystem'])}</ul></div>
<div><h3>${t.notKeptTitle}</h3><ul class="no">${li(['nCookies', 'nIp', 'nSize', 'nLanguage', 'nVisits'])}</ul></div></div>
<p>${t.counterNote} <a href="https://github.com/arp242/goatcounter">GoatCounter</a> · <a href="https://github.com/wyrtensi/stats">${t.source}</a></p>`;
}

export function updated(generated, now, lang) {
  const t = T[lang];
  const at = new Date(generated);
  const when = at.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const stale = now - at > 30 * 60 * 1000 ? ` — <strong>${t.stale}</strong>` : '';
  return `${t.updated}: ${esc(when)}${stale}`;
}
```

Bar widths come from `data-w` and are applied in `app.js` through the CSSOM (`el.style.setProperty`), which the CSP allows; there is no `style=` attribute in the HTML.

- [ ] **Step 5: Run the tests**

Run: `node --test tests/`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add page/i18n.js page/render.js tests/page.test.mjs tests/sample.json
git commit -m "feat(page): strings and rendering for overview, details, app and collected block"
```

---

### Task 5: Page shell, style and wiring

**Files:**
- Create: `page/index.html`, `page/style.css`, `page/app.js`, `page/favicon.svg`
- Modify: `tests/page.test.mjs`

**Interfaces:**
- Consumes: `T`, `pickLang` (i18n.js); `overview`, `details`, `collected`, `updated` (render.js); `data/<days>.json`.
- Produces: element ids used by `app.js`: `#period`, `#lang`, `#theme`, `#overview`, `#details`, `#collected`, `#updated`, `#error`.

- [ ] **Step 1: Add static checks to the tests**

Append to `tests/page.test.mjs`:

```js
test('index.html loads only same-origin resources and no inline code', async () => {
  const html = await readFile(new URL('../page/index.html', import.meta.url), 'utf8');
  assert.ok(!/(src|href)="(https?:)?\/\//.test(html.replace(/<a [^>]*>/g, '')), 'no external src/href except links');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'no inline scripts');
  assert.ok(!/\sstyle=/.test(html), 'no style attributes');
  assert.match(html, /<script type="module" src="\/app\.js"><\/script>/);
});
```

Run: `node --test tests/` — Expected: FAIL, `ENOENT ... page/index.html`.

- [ ] **Step 2: Create `page/index.html`**

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>wyrtensi · stats</title>
<meta name="description" content="Открытая статистика посещений rusinternet.com, wystore.ru и washguide.ru: без cookie и без IP-адресов.">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="top">
  <a class="brand" href="#">wyrtensi <span>· stats</span></a>
  <div class="controls">
    <div class="seg" id="period" role="group">
      <button type="button" data-days="7">7</button><button type="button" data-days="30">30</button><button type="button" data-days="90">90</button>
    </div>
    <button type="button" class="ghost" id="lang">English</button>
    <button type="button" class="ghost" id="theme" aria-label="Theme">◐</button>
  </div>
</header>
<main>
  <p class="lead" id="lead"></p>
  <p class="error" id="error" hidden></p>
  <section class="cards" id="overview"></section>
  <section class="details" id="details" hidden></section>
  <section class="collected" id="collected"></section>
</main>
<footer><p id="updated"></p></footer>
<script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `page/style.css`**

```css
:root{--bg:#f7f7f5;--fg:#16171a;--muted:#6b6f76;--line:#e3e3df;--accent:#4b5563;--soft:#ecece8;
  font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color-scheme:light}
:root[data-theme="dark"]{--bg:#121315;--fg:#e8e8e6;--muted:#9a9ea5;--line:#26282c;--accent:#c7cbd1;--soft:#1b1d20;color-scheme:dark}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121315;--fg:#e8e8e6;--muted:#9a9ea5;--line:#26282c;--accent:#c7cbd1;--soft:#1b1d20;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg)}
a{color:inherit}
header.top,main,footer{max-width:960px;margin:0 auto;padding:0 16px}
header.top{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding-top:28px}
.brand{font-weight:650;text-decoration:none;letter-spacing:.01em}.brand span{color:var(--muted);font-weight:400}
.controls{display:flex;gap:8px;align-items:center}
button{font:inherit;color:inherit;background:none;border:1px solid var(--line);border-radius:8px;padding:4px 10px;cursor:pointer}
.seg{display:flex}.seg button{border-radius:0;margin-left:-1px}.seg button:first-child{border-radius:8px 0 0 8px}
.seg button:last-child{border-radius:0 8px 8px 0}.seg button[aria-pressed="true"]{background:var(--fg);color:var(--bg)}
.ghost{border-color:transparent}
.lead{color:var(--muted);max-width:60ch;margin:28px 0}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
.card{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;align-items:baseline;padding:18px;border:1px solid var(--line);border-radius:12px;text-decoration:none}
.card:hover,.card[aria-current="true"]{background:var(--soft)}
.host{grid-column:1/-1;color:var(--muted);font-size:14px}
.big{font-size:32px;font-weight:650;font-variant-numeric:tabular-nums}.unit{color:var(--muted)}
.spark{grid-column:1/-1;width:100%;height:28px;margin-top:8px}.spark polyline{fill:none;stroke:var(--accent);stroke-width:1.5}
.details{margin-top:40px}.back{color:var(--muted);text-decoration:none;font-size:14px}
.bars{width:100%;height:140px;margin:8px 0 24px}.bars rect{fill:var(--accent);opacity:.75}
.lists{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:28px}
.list h3,.app h3,.collected h3{font-size:14px;color:var(--muted);font-weight:500;margin:0 0 8px}
.list ol{list-style:none;margin:0;padding:0}
.list li{position:relative;display:flex;justify-content:space-between;gap:12px;padding:6px 8px;border-bottom:1px solid var(--line)}
.list .bar{position:absolute;inset:0 auto 0 0;width:var(--w,0%);background:var(--soft);z-index:-1}
.list .name{overflow-wrap:anywhere}.num{font-variant-numeric:tabular-nums;color:var(--muted)}
.app{margin:0 0 28px;padding:16px;border:1px solid var(--line);border-radius:12px}
.app dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:0}
.app dt{color:var(--muted);font-size:14px}.app dd{margin:0;font-size:20px;font-weight:600}.app small{font-size:13px;color:var(--muted);font-weight:400}
.collected{margin:56px 0 0;padding-top:24px;border-top:1px solid var(--line)}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.yes li::marker{content:"+  "}.no li::marker{content:"–  "}
.empty,.error,footer{color:var(--muted)}footer{padding-top:32px;padding-bottom:40px;font-size:14px}
```

- [ ] **Step 4: Create `page/app.js`**

```js
// Wiring: load the period file, render, keep period/language/theme/site in sync.
import { T, pickLang } from './i18n.js';
import { overview, details, collected, updated } from './render.js';

const $ = (id) => document.getElementById(id);
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

const state = { days: Number(store.get('days')) || 30, lang: pickLang(navigator.language, store.get('lang')), data: null };
const theme = store.get('theme');
if (theme) document.documentElement.dataset.theme = theme;

async function load() {
  try {
    const r = await fetch(`/data/${state.days}.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    state.data = await r.json();
    $('error').hidden = true;
  } catch (err) {
    state.data = null;
    $('error').textContent = state.lang === 'ru' ? 'Не удалось загрузить данные.' : 'Could not load the data.';
    $('error').hidden = false;
    console.error('stats data', err);
  }
  render();
}

function render() {
  const t = T[state.lang];
  document.documentElement.lang = state.lang;
  $('lead').textContent = t.lead;
  $('lang').textContent = t.lang;
  $('theme').setAttribute('aria-label', t.theme);
  for (const b of $('period').querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.days) === state.days));
  $('collected').innerHTML = collected(state.lang);
  if (!state.data) { $('overview').innerHTML = ''; $('details').hidden = true; return; }
  $('overview').innerHTML = overview(state.data, state.lang);
  const host = decodeURIComponent(location.hash.slice(1));
  const site = state.data.sites.find((s) => s.host === host);
  for (const c of $('overview').querySelectorAll('.card')) c.setAttribute('aria-current', String(c.dataset.site === host));
  $('details').hidden = !site;
  $('details').innerHTML = site ? details(site, state.data.app, state.lang) : '';
  for (const bar of document.querySelectorAll('.bar[data-w]')) bar.style.setProperty('--w', `${bar.dataset.w}%`);
  $('updated').innerHTML = updated(state.data.generated, new Date(), state.lang);
}

$('period').addEventListener('click', (e) => {
  const days = Number(e.target.dataset?.days);
  if (!days) return;
  state.days = days; store.set('days', String(days)); load();
});
$('lang').addEventListener('click', () => { state.lang = state.lang === 'ru' ? 'en' : 'ru'; store.set('lang', state.lang); render(); });
$('theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  store.set('theme', document.documentElement.dataset.theme);
});
addEventListener('hashchange', render);
load();
```

- [ ] **Step 5: Create `page/favicon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#16171a"/><path d="M8 22V14M14 22V10M20 22V16M26 22V8" stroke="#f7f7f5" stroke-width="3" stroke-linecap="round"/></svg>
```

- [ ] **Step 6: Run tests and look at the page locally**

Run: `node --test tests/` — Expected: all pass.

Then: `mkdir -p page/data && cp tests/sample.json page/data/7.json && cp tests/sample.json page/data/30.json && cp tests/sample.json page/data/90.json` and serve `page/` with any static server (`python -m http.server -d page 8099`), open `http://localhost:8099/`, check: three cards; clicking wystore.ru shows the app block; RU/EN and theme switch work; at 360 px width nothing scrolls sideways. Delete `page/data/` afterwards and add `page/data/` to `.gitignore`.

- [ ] **Step 7: Commit**

```bash
printf 'page/data/\n' > .gitignore
git add .gitignore page/index.html page/style.css page/app.js page/favicon.svg tests/page.test.mjs
git commit -m "feat(page): neutral stats page with period, language and theme switches"
```

---

### Task 5b: Page — people and bots

**Files:**
- Modify: `page/i18n.js`, `page/render.js`, `page/style.css`
- Test: `tests/bots.test.mjs`, `tests/sample.json`

**Interfaces:**
- Consumes: `site.bots = {"requests": int, "list": [{"name", "category", "visits"}]}` (Task 3b); `overview`, `details`, `collected`, `T` (Tasks 4–5).
- Produces: new keys in both languages: `people`, `botRequests`, `bots`, `catSearch`, `catAi`, `catOther`, `cBots`.

- [ ] **Step 1: Add bots to the sample and write the failing tests**

In `tests/sample.json`, add to the `rusinternet.com` site
`"bots":{"requests":57,"list":[{"name":"YandexBot","category":"search","visits":40},{"name":"GPTBot","category":"ai","visits":17}]}`
and to the other two sites `"bots":{"requests":0,"list":[]}`.

```js
// tests/bots.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { T } from '../page/i18n.js';
import * as R from '../page/render.js';

const data = JSON.parse(await readFile(new URL('./sample.json', import.meta.url), 'utf8'));

test('cards show people and bot requests separately', () => {
  const html = R.overview(data, 'en');
  assert.ok(html.includes(T.en.people) && html.includes(T.en.botRequests));
  assert.match(html, /57/);
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
```

Run: `node --test tests/` — Expected: FAIL (`T.en.people` is undefined).

- [ ] **Step 2: Add the strings to `page/i18n.js`**

In `T.ru`:
`people: 'людей', botRequests: 'запросов ботов', bots: 'Боты', catSearch: 'поиск', catAi: 'ИИ', catOther: 'прочие', cBots: 'для ботов — только имя и число запросов',`

In `T.en`:
`people: 'people', botRequests: 'bot requests', bots: 'Bots', catSearch: 'search', catAi: 'AI', catOther: 'other', cBots: 'for bots, only the name and the number of requests',`

- [ ] **Step 3: Update `page/render.js`**

In `overview`, replace the line with `class="big"` and `class="unit"` by:

```js
  <span class="big">${fmt(s.visits, lang)}</span><span class="unit">${t.people}</span>
  <span class="bots">${fmt(s.bots?.requests ?? 0, lang)} ${t.botRequests}</span>
```

In `details`, change the empty check at the top to:

```js
  if (!site.visits && !site.bots?.requests) return `${head}${appHtml}<p class="empty">${t.noData}</p>`;
```

and after the `${list(t.systems, site.systems, lang)}` line add:

```js
${list(t.bots, site.bots?.list ?? [], lang,
  (b) => `${b.name} · ${({ search: t.catSearch, ai: t.catAi, other: t.catOther })[b.category] ?? t.catOther}`)}
```

(`list` already renders the `other` entry as `t.other` without calling the label function.)

In `collected`, inside the first column right after `<ul class="yes">...</ul>`, add:

```js
<p class="note">${t.cBots}</p>
```

Add to `page/style.css`:

```css
.bots{grid-column:1/-1;color:var(--muted);font-size:14px;font-variant-numeric:tabular-nums}
.note{color:var(--muted);font-size:14px;margin:8px 0 0}
```

- [ ] **Step 4: Run all page tests**

Run: `node --test tests/`
Expected: all pass, including Task 4's tests (the `overview` test still finds `12`, the `details` test still finds every list title).

- [ ] **Step 5: Commit**

```bash
git add page/i18n.js page/render.js page/style.css tests/bots.test.mjs tests/sample.json
git commit -m "feat(page): people and bot requests per site, bots by category"
```

---

### Task 5c: Languages, and a friendlier, nicer page

The operator turned on two more things in GoatCounter: browser language and
individual pageviews (each view stored with its time; still no IP, no
cookies). The operator also asked for a page that an ordinary person
understands at a glance and that is pleasant to look at. This task does both.

**Files:**
- Modify: `export/stats_export.py`, `export/tests/test_stats_export.py`, `export/tests/fixtures/languages.json` (create)
- Modify: `page/i18n.js`, `page/render.js`, `page/app.js`, `page/style.css`, `page/index.html`
- Test: `tests/page.test.mjs`, `tests/bots.test.mjs`, `tests/sample.json`, new `tests/friendly.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 2–5b.
- Produces:
  - exporter: `BREAKDOWNS` gains `"languages": "languages"`; every site in a period file gets `"languages": [{"name", "visits"}]` (top 10 plus "other"); `COLLECTED` becomes `["page", "time", "referrer", "country", "language", "browser", "system"]`.
  - page: `export const SITE_INFO = { "rusinternet.com": {...}, "wystore.ru": {...}, "washguide.ru": {...} }` in `render.js` with `color` (a CSS custom property name) and `about` (i18n key); `export function summary(data, lang): string`; `export function pct(n, total): string` (`"75%"`, `"<1%"` for a non-zero share under 1%, `"0%"` for zero).

#### Content requirements (exact wording is in the i18n step below)

1. **Summary line** at the top, under the lead: total people over the period and the most visited site, for example "За последние 30 дней на наши сайты зашли 15 человек. Больше всего — на rusinternet.com." Russian numerals agree (`1 человек`, `2 человека`, `5 человек`; `1 день`, `2 дня`, `5 дней`). If the total is 0: "За последние 30 дней посещений пока нет."
2. **Cards:** a colour dot and the host, a one-line description of the site under it, the number of people (large), "людей" / "people" with the right plural, bot requests in plain words ("и 57 запросов от роботов поисковиков и ИИ"), a sparkline in the site's colour, and "Подробнее →" / "Details →".
3. **Period switch** reads "7 дней · 30 дней · 90 дней" / "7 days · 30 days · 90 days", with an `aria-label` from i18n.
4. **Details:** site title with its dot and description; the people total; the daily chart; each list with a heading and a one-line plain hint under it:
   - Pages — "какие страницы открывали"
   - Referrers ("Откуда пришли") — "поисковики и сайты, где была ссылка; «напрямую» — набрали адрес или открыли закладку"
   - Countries — "по адресу подключения; сам адрес не сохраняется"
   - Languages ("Языки") — "язык, выбранный в браузере"
   - Browsers, Systems — no hint needed
   - Bots ("Роботы") — "поисковики и ИИ-сервисы, которые читают сайт; людьми не считаются"
   Each row shows the count and the share: "9 · 75%". The share is of the site's people for the period (`site.visits`); for robots it is of the site's bot requests.
   Names: an empty or `"unknown"` name shows as "не определено" / "unknown"; `"other"` shows as "другие" / "others"; an empty referrer shows as "напрямую" / "direct". Bot categories read "поиск", "ИИ", "прочие".
5. **Daily chart:** bars in the site's colour with rounded tops, at most 80% of the chart height, the first and last date under the chart, and a `<title>` per bar with the formatted date and count. An empty period shows the no-data line instead of a chart.
6. **What we collect** reads, in plain words:
   - Kept, for each view: page, time, referrer, country, browser language, browser, system. Bots: only the bot's name and number of requests.
   - Not kept: cookies, IP addresses, screen size.
   - One line: "Каждый просмотр хранится отдельно, но здесь показана только сводка."
7. **Look:** light theme by default when the system is light; soft card shadows instead of borders (borders stay in dark theme where shadows don't read); more spacing; large numbers 40px; system font; the three site colours are muted (a blue, a violet, a warm amber) with dark-theme variants; everything else stays neutral grey. At 360 px wide: one card per row, lists in one column, header controls wrap under the brand, no horizontal scroll.
8. **Robustness fixes from earlier reviews** (ledger minors), all in this task:
   - list bars: `isolation:isolate` on `.list li`, bar at `z-index:0`, text above it;
   - `decodeURIComponent` of the hash wrapped in try/catch (bad hash → overview only);
   - period loads: ignore a response that is not for the period currently selected;
   - error text re-rendered in the current language on language switch;
   - stored period accepted only if it is 7, 30 or 90;
   - bar-chart `<title>` values escaped and formatted; app link used only if it starts with `https://github.com/`;
   - an unparseable `generated` counts as stale;
   - `pickLang` compares the whole primary subtag (`uk-UA` → `uk`), not the first two letters.

- [ ] **Step 1: Exporter — languages and collected list (TDD)**

Record `export/tests/fixtures/languages.json` on the server exactly like the other stats fixtures (Task 1, Step 3, with `languages` in the loop). Add to `export/tests/test_stats_export.py`:

```python
class Languages(unittest.TestCase):
    def test_languages_and_collected(self):
        out = se.build_period(FakeApi(), 30, NOW)
        self.assertEqual(out["collected"], ["page", "time", "referrer", "country", "language", "browser", "system"])
        self.assertIn("languages", out["sites"][0])
        self.assertTrue(all({"name", "visits"} <= set(x) for x in out["sites"][0]["languages"]))
```

Update `test_shape_and_sites` to expect the new `collected` value, and `test_site_without_paths_is_empty` to include `"languages": []`. Also stop replacing empty names with `"unknown"` in `build_site` (keep `s["name"]` as is): the page decides that an empty referrer means "direct" and an empty name elsewhere means "unknown"; add a test that an empty name from the API stays `""`. Run `python -W error -m unittest discover -s export/tests -v`, see the failures, then change `COLLECTED`, `BREAKDOWNS` and `empty_site` in `export/stats_export.py`. Run again: all pass. Commit `feat(export): browser languages per site`.

- [ ] **Step 2: Page tests first**

Add `"languages":[{"name":"Russian","visits":10},{"name":"","visits":2}]` and a referrer `{"name":"","visits":3}` to the `rusinternet.com` site in `tests/sample.json` (and `"languages":[]` to the others; update `collected` to the new list). Create `tests/friendly.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { T, pickLang } from '../page/i18n.js';
import * as R from '../page/render.js';

const data = JSON.parse(await readFile(new URL('./sample.json', import.meta.url), 'utf8'));

test('summary names the total and the busiest site, with Russian plurals', () => {
  const ru = R.summary(data, 'ru');
  assert.match(ru, /15 человек/);
  assert.ok(ru.includes('rusinternet.com'));
  const one = structuredClone(data); one.sites = [{ ...data.sites[0], visits: 1 }, { ...data.sites[1], visits: 0 }, { ...data.sites[2], visits: 0 }];
  assert.match(R.summary(one, 'ru'), /1 человек\b/);
  const none = structuredClone(data); for (const s of none.sites) s.visits = 0;
  assert.ok(R.summary(none, 'ru').includes(T.ru.summaryNone.replace('{days}', '7 дней')));
});

test('shares', () => {
  assert.equal(R.pct(9, 12), '75%');
  assert.equal(R.pct(1, 300), '<1%');
  assert.equal(R.pct(0, 12), '0%');
});

test('cards carry site colour, description and Details link', () => {
  const html = R.overview(data, 'ru');
  assert.ok(html.includes(T.ru[R.SITE_INFO['wystore.ru'].about]));
  assert.ok(html.includes(T.ru.more));
  assert.match(html, /data-color="site-1"/);
});

test('plain names: unknown, other, direct', () => {
  const html = R.details(data.sites[0], null, 'ru');
  assert.ok(html.includes(T.ru.unknown) && html.includes(T.ru.direct) && html.includes(T.ru.other));
  assert.ok(!/>unknown</.test(html));
  assert.ok(html.includes(T.ru.languages) && html.includes(T.ru.hintLanguages));
  assert.match(html, /9 · 75%/);
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
});
```

Update the Task 4 and 5b tests whose expectations change because of the new wording (`T.en.visits` → `T.en.people`, removed keys `nLanguage`, `nVisits`); keep each test's intent. Run `node --test`: the new tests fail.

- [ ] **Step 3: i18n**

Replace and add keys in both languages (both languages must keep identical key sets). Russian values:

```
lead: 'Сколько людей заходит на наши сайты. Без cookie и без IP-адресов.',
summary: 'За последние {days} на наши сайты зашли {people}. Больше всего — на {site}.',
summaryNone: 'За последние {days} посещений пока нет.',
peopleOne: 'человек', peopleFew: 'человека', peopleMany: 'человек',
dayOne: 'день', dayFew: 'дня', dayMany: 'дней',
botsLine: 'и {n} запросов от роботов поисковиков и ИИ',
more: 'Подробнее →', periodLabel: 'Период',
aboutRusinternet: 'Сертификаты Минцифры', aboutWystore: 'Магазин приложений для Android', aboutWashguide: 'Справочник старых стиральных машин',
pages: 'Страницы', hintPages: 'какие страницы открывали',
referrers: 'Откуда пришли', hintReferrers: 'поисковики и сайты, где была ссылка; «напрямую» — набрали адрес или открыли закладку',
countries: 'Страны', hintCountries: 'по адресу подключения; сам адрес не сохраняется',
languages: 'Языки', hintLanguages: 'язык, выбранный в браузере',
browsers: 'Браузеры', systems: 'Системы',
bots: 'Роботы', hintBots: 'поисковики и ИИ-сервисы, которые читают сайт; людьми не считаются',
other: 'другие', unknown: 'не определено', direct: 'напрямую',
cPage: 'страница', cTime: 'время', cReferrer: 'откуда пришли', cCountry: 'страна', cLanguage: 'язык браузера', cBrowser: 'браузер', cSystem: 'система',
cBots: 'для роботов — только имя и число запросов',
nCookies: 'cookie', nIp: 'IP-адреса', nSize: 'размер экрана',
keptTitle: 'Сохраняется для каждого просмотра', notKeptTitle: 'Не сохраняется',
summaryOnly: 'Каждый просмотр хранится отдельно, но здесь показана только сводка.',
```

English values:

```
lead: 'How many people visit our sites. No cookies and no IP addresses.',
summary: 'In the last {days}, {people} visited our sites. Most went to {site}.',
summaryNone: 'No visits in the last {days} yet.',
peopleOne: 'person', peopleFew: 'people', peopleMany: 'people',
dayOne: 'day', dayFew: 'days', dayMany: 'days',
botsLine: 'and {n} requests from search and AI robots',
more: 'Details →', periodLabel: 'Period',
aboutRusinternet: 'Russian root certificates', aboutWystore: 'An Android app store', aboutWashguide: 'A guide to old washing machines',
pages: 'Pages', hintPages: 'which pages were opened',
referrers: 'Where people came from', hintReferrers: 'search engines and sites with a link; “direct” means typed or bookmarked',
countries: 'Countries', hintCountries: 'from the connection address; the address itself is not kept',
languages: 'Languages', hintLanguages: 'the language set in the browser',
browsers: 'Browsers', systems: 'Systems',
bots: 'Robots', hintBots: 'search engines and AI services reading the site; not counted as people',
other: 'others', unknown: 'unknown', direct: 'direct',
cPage: 'page', cTime: 'time', cReferrer: 'where they came from', cCountry: 'country', cLanguage: 'browser language', cBrowser: 'browser', cSystem: 'system',
cBots: 'for robots, only the name and the number of requests',
nCookies: 'cookies', nIp: 'IP addresses', nSize: 'screen size',
keptTitle: 'Kept for each view', notKeptTitle: 'Not kept',
summaryOnly: 'Each view is stored separately, but this page shows only the summary.',
```

Remove `nLanguage`, `nVisits`, `visits`, `botRequests`, `people` (replaced by the plural keys) and any other key no longer used. Add `export function plural(n, one, few, many)` to `i18n.js` (Russian rules: 1, 21, 31… → one; 2–4, 22–24… → few; else many; English: 1 → one, else many).

- [ ] **Step 4: render.js, app.js, style.css, index.html**

Implement the content requirements above. Constraints: pure functions in `render.js`, all data escaped, no inline styles (site colour goes through a `data-color="site-1|site-2|site-3"` attribute that CSS maps to `--site-1…3`), no external resources, CSP unchanged. Period buttons get their text from i18n in `render()`. Apply every robustness fix from the list.

Visual direction: light background `#f6f6f3`, cards white with `box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.06)`, radius 16px, padding 22px, gap 20px; site colours `--site-1:#4f7cac` (rusinternet), `--site-2:#8a6fb0` (wystore), `--site-3:#c08a3e` (washguide) with lighter dark-theme variants (`#7fa3cc`, `#ab95cf`, `#d6a861`); numbers 40px semibold with tabular figures; hints 13px muted; max content width 1040px.

- [ ] **Step 5: Run everything**

`node --test` and `python -W error -m unittest discover -s export/tests`: all pass, output pristine. Serve `page/` with sample data as in Task 5 and confirm every asset answers 200; the controller does the visual check.

- [ ] **Step 6: Commit**

```bash
git add page tests export
git commit -m "feat(page): plain-language, friendlier stats page with languages"
```

---

### Task 6: Server configuration files

**Files:**
- Create: `deploy/server/docker-compose.yml`, `deploy/server/Caddyfile`, `deploy/server/stats.wyrtensi.caddy`, `deploy/server/stats-deploy.sh`, `deploy/server/stats-export.service`, `deploy/server/stats-export.timer`
- Test: `tests/deploy.test.mjs`

**Interfaces:**
- Produces: forced command `/usr/local/bin/stats-deploy` (`rsync --server ...` into releases, `activate <release>`); timer `stats-export.timer`; containers `goatcounter` (base path `/admin`) and `stats-web`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/deploy.test.mjs
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
```

Run: `node --test tests/` — Expected: FAIL on missing files.

- [ ] **Step 2: Create `deploy/server/docker-compose.yml`**

```yaml
version: "2.4"

# Lives in /opt/stats. GoatCounter counts for rusinternet.com, wystore.ru and
# washguide.ru (one site, stats.wyrtensi.ru; paths carry the host in front) and
# serves its own dashboard under /admin. stats-web serves the public page from
# /opt/stats/page/current; /opt/stats/page/data is written by stats-export.
# No published ports: edge-caddy proxies here over the "proxy" network.
services:
  goatcounter:
    image: arp242/goatcounter:2.7.0
    container_name: goatcounter
    restart: unless-stopped
    command: ["serve", "-listen", ":8080", "-tls", "http", "-automigrate", "-base-path", "/admin", "-db", "sqlite+/home/goatcounter/goatcounter-data/db.sqlite3"]
    volumes:
      - ./data:/home/goatcounter/goatcounter-data
    networks:
      - proxy
    mem_limit: 96m
    logging:
      driver: json-file
      options: { max-size: "2m", max-file: "2" }

  web:
    image: caddy:2-alpine
    container_name: stats-web
    restart: unless-stopped
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./page:/srv:ro
    networks:
      - proxy
    mem_limit: 32m
    logging:
      driver: json-file
      options: { max-size: "2m", max-file: "2" }

networks:
  proxy:
    external: true
```

- [ ] **Step 3: Create `deploy/server/Caddyfile`**

```
# Static server for the public stats page inside stats-web. edge-caddy ends TLS.
{
	admin off
	auto_https off
}

:80 {
	root * /srv/current
	encode zstd gzip
	header {
		Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
		-Server
	}
	@data path /data/*
	header @data Cache-Control "no-cache"
	@assets path *.js *.css *.svg
	header @assets Cache-Control "public, max-age=3600"
	file_server
}
```

- [ ] **Step 4: Create `deploy/server/stats.wyrtensi.caddy`**

```
# Lives in /opt/edge/sites/. Public stats page; GoatCounter's own dashboard and
# API stay under /admin. The sites send counts through their own /stats/count.
stats.wyrtensi.ru {
	header {
		Strict-Transport-Security "max-age=31536000"
		-Server
	}

	@admin path /admin /admin/*
	handle @admin {
		reverse_proxy goatcounter:8080
	}

	handle {
		reverse_proxy stats-web:80
	}
}
```

- [ ] **Step 5: Create `deploy/server/stats-deploy.sh`**

```sh
#!/bin/sh
# Forced command for the GitHub Actions deploy key of the stats page (user
# stdeploy). The key can do exactly two things:
#   rsync ... <release>/   upload a build into releases/<release> (write-only)
#   activate <release>     link the shared data dir in, point "current" at it,
#                          keep the 5 newest releases
# Installed as /usr/local/bin/stats-deploy.
set -eu

site=/opt/stats/page
command=${SSH_ORIGINAL_COMMAND:-}

case "$command" in
  "rsync --server "*)
    exec /usr/bin/rrsync -wo "$site/releases"
    ;;
  "activate "*)
    release=${command#activate }
    case "$release" in
      ""|*[!a-z0-9-]*) echo "invalid release name" >&2; exit 1 ;;
    esac
    for file in index.html app.js render.js i18n.js style.css; do
      if [ ! -f "$site/releases/$release/$file" ]; then
        echo "release $release is incomplete: no $file" >&2
        exit 1
      fi
    done
    ln -sfn ../../data "$site/releases/$release/data"
    ln -sfn "releases/$release" "$site/current.next"
    mv -T "$site/current.next" "$site/current"
    ls -1 "$site/releases" | sort -r | tail -n +6 | while read -r old; do
      [ "$old" = "$release" ] || rm -rf -- "$site/releases/$old"
    done
    echo "activated $release"
    ;;
  *)
    echo "command not allowed" >&2
    exit 1
    ;;
esac
```

- [ ] **Step 6: Create the systemd units**

`deploy/server/stats-export.service`:

```ini
[Unit]
Description=Export visit statistics for stats.wyrtensi.ru
After=docker.service

[Service]
Type=oneshot
# Through edge-caddy on this same server; the token never leaves the machine.
ExecStart=/usr/bin/python3 /usr/local/bin/stats-export --out /opt/stats/page/data --token-file /etc/stats/token --state /opt/stats/state/bots.json --base https://stats.wyrtensi.ru/admin
Nice=10
```

`deploy/server/stats-export.timer`:

```ini
[Unit]
Description=Export visit statistics every 10 minutes

[Timer]
OnCalendar=*:0/10
Persistent=true

[Install]
WantedBy=timers.target
```

Note: with `-base-path /admin`, API paths become `/admin/api/v0/...`; `--base` ends in `/admin` and `Api.get` appends `/api/v0/...`.

- [ ] **Step 7: Run the tests**

Run: `node --test tests/` — Expected: all pass (the forced-command test is skipped where `sh` is missing).

- [ ] **Step 8: Commit**

```bash
git add deploy/server tests/deploy.test.mjs
git commit -m "feat(deploy): GoatCounter under /admin, stats-web, edge route, deploy key and export timer"
```

---

### Task 7: CI workflow and smoke check

**Files:**
- Create: `.github/workflows/site.yml`, `.github/scripts/smoke.mjs`, `README.md`

**Interfaces:**
- Consumes: `page/`, tests, environment `production` with secrets `STATS_DEPLOY_KEY`, `DEPLOY_HOST`, `DEPLOY_HOST_KEY` (Task 8).

- [ ] **Step 1: Create `.github/scripts/smoke.mjs`**

```js
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
```

- [ ] **Step 2: Create `.github/workflows/site.yml`**

```yaml
name: Site

# Tests the exporter and the page, deploys page/ as a new release on our server
# behind the shared Caddy, then checks the live page. Server pieces in
# deploy/server/ are installed by hand.

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: site
  cancel-in-progress: false

jobs:
  test:
    name: Test exporter and page
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5
        with:
          node-version: 24
      - name: Exporter tests
        run: python3 -m unittest discover -s export/tests -v
      - name: Page and deploy tests
        run: node --test tests/
      - name: Upload page
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: page
          path: page
          retention-days: 7

  deploy:
    name: Deploy to the server
    needs: test
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment:
      name: production
      url: https://stats.wyrtensi.ru/
    env:
      DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}
      DEPLOY_HOST_KEY: ${{ secrets.DEPLOY_HOST_KEY }}
    steps:
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: page
          path: page
      - name: Upload and activate the release
        env:
          DEPLOY_KEY: ${{ secrets.STATS_DEPLOY_KEY }}
        run: |
          install -d -m 700 ~/.ssh
          printf '%s\n' "$DEPLOY_KEY" > ~/.ssh/deploy_key
          chmod 600 ~/.ssh/deploy_key
          printf '%s\n' "$DEPLOY_HOST_KEY" > ~/.ssh/known_hosts
          release="$(date -u +%Y%m%d%H%M%S)-${GITHUB_SHA::7}"
          ssh_command="ssh -i $HOME/.ssh/deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$HOME/.ssh/known_hosts"
          rsync -rlt --chmod=D755,F644 --exclude data -e "$ssh_command" page/ "stdeploy@$DEPLOY_HOST:$release/"
          $ssh_command "stdeploy@$DEPLOY_HOST" "activate $release"
          rm -f ~/.ssh/deploy_key

  smoke:
    name: Check the live page
    needs: deploy
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5
        with:
          node-version: 24
      - run: node .github/scripts/smoke.mjs
```

- [ ] **Step 3: Create `README.md`**

```markdown
# stats.wyrtensi.ru

Public visit statistics for rusinternet.com, wystore.ru and washguide.ru, and
Wy Store's release downloads. No cookies, no IP addresses.

- `page/` — the static page (no dependencies, no build step).
- `export/` — `stats_export.py`, run every 10 minutes by `stats-export.timer`;
  writes `data/{7,30,90}.json` from the GoatCounter and GitHub APIs.
- `deploy/server/` — GoatCounter, the page server, the edge route, the deploy
  key's forced command and the timer. Installed by hand; CI deploys only `page/`.

Tests: `python -m unittest discover -s export/tests` and `node --test tests/`.
```

- [ ] **Step 4: Run all tests locally**

Run: `python -m unittest discover -s export/tests && node --test tests/`
Expected: both `OK` / all pass.

- [ ] **Step 5: Commit**

```bash
git add .github README.md
git commit -m "ci: test, deploy the page and check it live"
```

---

### Task 8: Server rollout (operator steps; each needs the user's yes, given for this plan)

Order keeps the counter reachable all the time. The current state: GoatCounter at the root of its vhost, sites proxy `/stats/count*` with `uri strip_prefix /stats`, `stats.wyrtensi.ru` proxies everything to GoatCounter.

- [ ] **Step 1: Deploy user, secrets, environment**

```sh
# local, in the scratchpad: key for this site only
ssh-keygen -q -t ed25519 -N "" -C "stats-actions-deploy" -f deploy_key
scp -i <root key> deploy/server/stats-deploy.sh deploy_key.pub root@192.144.58.198:/root/
# server
install -m 755 /root/stats-deploy.sh /usr/local/bin/stats-deploy
useradd --system --create-home --shell /bin/sh stdeploy
install -d -m 700 -o stdeploy -g stdeploy /home/stdeploy/.ssh
printf 'restrict,command="/usr/local/bin/stats-deploy" %s\n' "$(cat /root/deploy_key.pub)" > /home/stdeploy/.ssh/authorized_keys
chown stdeploy: /home/stdeploy/.ssh/authorized_keys; chmod 600 /home/stdeploy/.ssh/authorized_keys
install -d -m 755 -o stdeploy -g stdeploy /opt/stats/page /opt/stats/page/releases
install -d -m 755 /opt/stats/page/data
install -d -m 700 /opt/stats/state
rm /root/stats-deploy.sh /root/deploy_key.pub
```

```sh
# local (Bash tool)
gh api -X PUT repos/wyrtensi/stats/environments/production --input - <<< '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
gh api -X POST repos/wyrtensi/stats/environments/production/deployment-branch-policies -f name=main -f type=branch
gh secret set STATS_DEPLOY_KEY -R wyrtensi/stats -e production < deploy_key && rm deploy_key
gh secret set DEPLOY_HOST -R wyrtensi/stats -e production --body 192.144.58.198
gh secret set DEPLOY_HOST_KEY -R wyrtensi/stats -e production --body "192.144.58.198 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGOZ0fO8Qdcb+HvRDeYCoWBhO4mXePpSMC19rBCDvdvn"
```

Check: `ssh -i deploy_key stdeploy@192.144.58.198 true` (before deleting the key) answers `command not allowed`.

- [ ] **Step 2: Exporter and first data, against GoatCounter as it is now (no base path yet)**

```sh
scp export/stats_export.py deploy/server/stats-export.service deploy/server/stats-export.timer root@...:/root/
# server
install -m 755 /root/stats_export.py /usr/local/bin/stats-export
G=$(docker inspect -f '{{(index .NetworkSettings.Networks "proxy").IPAddress}}' goatcounter)
python3 /usr/local/bin/stats-export --out /opt/stats/page/data --token-file /etc/stats/token --base "http://$G:8080" --host stats.wyrtensi.ru
ls -l /opt/stats/page/data
```

Expected: `7.json 30.json 90.json`. Do not install the units yet (they point at `/admin`).

- [ ] **Step 3: stats-web and the first page release**

Copy `deploy/server/docker-compose.yml` and `Caddyfile` to `/opt/stats`, but start only the page server: `cd /opt/stats && docker-compose up -d web`. Push `main`; the Site workflow deploys the page. The `smoke` job fails at this point (the edge still sends `/` to GoatCounter); that is expected. Check on the server: `docker exec stats-web wget -qO- http://localhost/ | head -3` shows the HTML and `.../data/30.json` answers.

- [ ] **Step 4: One switch — base path, edge routes, timer**

Prepare the site routes first (three small PRs, merged right after this step's restart):
in `wyrtensi/rusinternet` `deploy/server/edge/sites/rusinternet.caddy`, `wyrtensi/wystore` `deploy/server/wystore.caddy`, `wyrtensi/washguide` `deploy/server/washguide.caddy`, replace

```
		uri strip_prefix /stats
```

with

```
		uri replace /stats/ /admin/
```

and update the comment's "see rusinternet deploy/server/stats" to "see wyrtensi/stats deploy/server". In rusinternet also delete `deploy/server/stats/` and point the layout comment at `wyrtensi/stats`. In rusinternet `tests/deployment.test.ts`, the counter-route test now expects `uri replace /stats/ /admin/`.

Then on the server, in one go:

```sh
cd /opt/stats && docker-compose rm -sf goatcounter && docker-compose up -d goatcounter   # now with -base-path /admin
b=/root/edge-sites-backup/$(date +%Y%m%d%H%M); mkdir -p $b; cp /opt/edge/sites/*.caddy $b/
install -m 644 <new stats.wyrtensi.caddy, rusinternet.caddy, wystore.caddy, washguide.caddy> /opt/edge/sites/
docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile || { cp $b/*.caddy /opt/edge/sites/; exit 1; }
docker restart edge-caddy
install -m 644 /root/stats-export.service /root/stats-export.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now stats-export.timer && systemctl start stats-export.service
systemctl status stats-export.service --no-pager | tail -3
```

Checks: `curl -sI https://stats.wyrtensi.ru/` is our page (CSP header present); `https://stats.wyrtensi.ru/admin/` is GoatCounter; `https://<each site>/stats/count.js` answers 200; open each site in a browser and see the visit in `/admin/` within a minute.

- [ ] **Step 5: Dashboard back to private**

In `https://stats.wyrtensi.ru/admin/settings/main` (signed in as the user), "Dashboard viewable by" → "Only logged in users", Save. Check: an anonymous `curl -s -o /dev/null -w "%{http_code}" https://stats.wyrtensi.ru/admin/` is a redirect to the login page.

- [ ] **Step 6: Merge the three site PRs and rerun the stats smoke**

Merge rusinternet, wystore, washguide PRs; watch their deploys (all jobs green). Rerun the stats Site workflow's `smoke` job: `gh run rerun <id> --failed -R wyrtensi/stats`. Expected: `Production OK: page, fresh data, private admin, counter script.`

---

## Self-review notes

- Spec coverage: bots (Tasks 3b, 5b; `--state` in Task 6; state dir in Task 8); architecture (Tasks 6, 8), token (Task 1), data file and app block (Tasks 2–3), page sections, language, theme, no external requests, stale note (Tasks 4–5), errors (Task 3 tests, Task 5 error element), deployment (Tasks 7–8), testing (Tasks 2–7), dashboard private (Task 8 Step 5).
- Names used across tasks: `site_of`, `top`, `write_atomic`, `build_period`, `build_app`, `fetch_releases`, `run`, `main`; `overview`, `details`, `appBlock`, `collected`, `updated`, `sparkline`, `bars`, `fmt`; `T`, `pickLang`; container `stats-web`, user `stdeploy`, secret `STATS_DEPLOY_KEY`.

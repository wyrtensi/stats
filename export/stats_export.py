"""Exports aggregated GoatCounter statistics (and Wy Store release downloads)
to static JSON for the public page at stats.wyrtensi.ru. Standard library only;
runs on the server from stats-export.timer."""
import argparse
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
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

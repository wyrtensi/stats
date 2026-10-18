"""Exports aggregated GoatCounter statistics (and Wy Store release downloads)
to static JSON for the public page at stats.wyrtensi.ru. Standard library only;
runs on the server from stats-export.timer."""
import argparse
import json
import os
import re
import subprocess
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
COLLECTED = ["page", "time", "referrer", "country", "language", "browser", "system"]
BREAKDOWNS = {"referrers": "toprefs", "countries": "locations", "languages": "languages",
              "browsers": "browsers", "systems": "systems"}
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
            "referrers": [], "countries": [], "languages": [], "browsers": [], "systems": []}


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
        # Names stay as GoatCounter gives them ("" for a direct referrer); the
        # page decides how to show empty and unknown names.
        site[key] = top([{"name": s["name"], "visits": s["count"]} for s in stats])
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


def main(argv):
    parser = argparse.ArgumentParser(prog="stats-export")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--host", default=None, help="Host header, only when --base is a container address")
    parser.add_argument("--state", type=Path, default=None)
    args = parser.parse_args(argv)
    api = Api(args.base, args.token_file.read_text("utf-8").strip(), args.host)
    return run(args.out, api, fetch_releases, datetime.now(timezone.utc), args.state)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

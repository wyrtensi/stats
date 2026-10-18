import contextlib, io, json, os, sys, tempfile, unittest
from datetime import datetime, timezone
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
        with contextlib.redirect_stderr(io.StringIO()):
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


if __name__ == "__main__":
    unittest.main()

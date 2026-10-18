import contextlib, io, json, sys, tempfile, unittest
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
            with contextlib.redirect_stderr(io.StringIO()):
                code = se.run(out, FakeApi(), lambda: [], datetime(2026, 10, 18, 16, 7, tzinfo=timezone.utc), state, broken)
            self.assertEqual(code, 0)
            data = json.loads((out / "7.json").read_text("utf-8"))
            self.assertEqual(next(s for s in data["sites"] if s["host"] == "wystore.ru")["bots"]["requests"], 4)

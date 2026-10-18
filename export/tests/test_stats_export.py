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

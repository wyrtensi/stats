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

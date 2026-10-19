# stats.wyrtensi.ru

Public visit statistics for rusinternet.com, wystore.ru, washguide.ru and
wyrtensi.github.io/showmehow, and
Wy Store's release downloads. No cookies, no IP addresses.

- `page/` — the static page (no dependencies, no build step).
- `export/` — `stats_export.py`, run every 10 minutes by `stats-export.timer`;
  writes `data/{7,30,90}.json` from the GoatCounter and GitHub APIs.
- `deploy/server/` — GoatCounter, the page server, the edge route, the deploy
  key's forced command and the timer. Installed by hand; CI deploys only `page/`.

Tests: `python -m unittest discover -s export/tests` and `node --test`.

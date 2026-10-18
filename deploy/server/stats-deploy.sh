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

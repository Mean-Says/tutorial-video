#!/usr/bin/env bash
# Brings the Chrome tab whose title contains <marker> to the front and sets its window bounds.
#   chrome-window.sh <marker> <left> <top> <right> <bottom>
# Get marker + bounds from __tut.windowPlan(w, h) in the page. Env: TUT_BROWSER (default "Google Chrome").
set -euo pipefail
[ $# -eq 5 ] || { echo "uso: chrome-window.sh <marker> <left> <top> <right> <bottom>" >&2; exit 2; }
marker="$1"; l="$2"; t="$3"; r="$4"; b="$5"
app="${TUT_BROWSER:-Google Chrome}"

found="$(osascript <<APPLESCRIPT
tell application "$app"
  set hit to false
  repeat with w in windows
    set n to 0
    repeat with tb in tabs of w
      set n to n + 1
      if (title of tb) contains "$marker" then
        set active tab index of w to n
        set index of w to 1
        set bounds of w to {$l, $t, $r, $b}
        set hit to true
        exit repeat
      end if
    end repeat
    if hit then exit repeat
  end repeat
  if hit then activate
  return hit
end tell
APPLESCRIPT
)"

if [ "$found" = "true" ]; then
  echo "RESULT {\"ok\":true,\"bounds\":[$l,$t,$r,$b]}"
else
  echo "ERRO: nenhuma aba com '$marker' no título. A janela está em tela cheia (saia do full screen) ou o título mudou?" >&2
  echo "RESULT {\"ok\":false}"
  exit 1
fi

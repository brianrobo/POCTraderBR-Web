#!/bin/sh
# Makes one annotated chart image. Run from the repository root (Git Bash), with the app running on port 8000.
#   sh tools/insight-charts/make.sh <scenario id> <spec.json> <work dir> <out.png>
# The work dir holds the fetched bars, the page and Chrome's profile (use a temporary folder).
SCENARIO="$1"; SPEC="$2"; WORK="$3"; OUT="$4"
mkdir -p "$WORK" || exit 1
curl -s -f "http://127.0.0.1:8000/api/sim/scenarios/$SCENARIO/bars" -o "$WORK/bars.json" || exit 1
SIZE=$(backend/.venv/Scripts/python.exe -X utf8 tools/insight-charts/insight_chart.py "$WORK/bars.json" "$SPEC" "$WORK/page.html") || exit 1
set -- $SIZE
node tools/insight-charts/shot.mjs "$WORK" "$WORK/page.html" "$1" "$2" shot && cp "$WORK/shot.png" "$OUT" && ls -l "$OUT"

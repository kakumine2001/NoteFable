#!/usr/bin/env bash
# Frames the raw store screenshots with the Google Play captions (mobile/ios/app-store/frame.html) and writes opaque
# JPEGs at the App Store sizes, NN-name.jpg in display order, for mobile/ios/app-store/screenshots/<iphone|ipad>/.
# Usage: ci-store-compose.sh <raw-dir> <out-dir> <iphone|ipad>
#   <raw-dir>  ci-screenshots.sh captures of the store scenes (<out>/ios26/light)
# Fails on a missing or wrong-sized capture, a blank web editor, or an output that is not exactly the store size.
# Env: NF_CHROME (headless Chrome; default: the macOS runner's Google Chrome)
# Written for macOS /bin/bash (bash 3.2).
set -euo pipefail

USAGE="usage: ci-store-compose.sh <raw-dir> <out-dir> <iphone|ipad>"
RAW=${1:?$USAGE}
OUT=${2:?$USAGE}
DEVICE=${3:?$USAGE}
case "$DEVICE" in
  iphone) WIDTH=1206 HEIGHT=2622 ;;
  ipad) WIDTH=2064 HEIGHT=2752 ;;
  *) echo "::error::Unknown device: $DEVICE"; exit 1 ;;
esac

CHROME=${NF_CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}
FRAME="$(cd "$(dirname "$0")/.." && pwd)/app-store/frame.html"
# Inter (SIL OFL), pinned. The Play frame used Windows' Segoe UI, which we can't use here.
FONT_URL=https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.2.8/files/inter-latin-opsz-normal.woff2
FONT_SHA256=2c295d99e26dcf357d4d01bcf270fd6924b600c9a13dd8c363ef114f4c6976fa

# file name;scene;eyebrow;title lines split by | (the captions and order of mobile/android/play-store/screenshots/)
SHOTS=(
  "01-answer;store-answer;Ask anything;Clear answers for what|you are studying"
  "02-table;store-table;Learn faster;Tables and lists that make|sense at a glance"
  "03-workspace;store-workspace;Your workspace;Notes, slides and|whiteboards"
  "04-mindmap;store-mindmap;Think visually;Mind maps and study|templates"
  "05-slides;store-slides;Share your ideas;Build slide decks and|present them"
  "06-models;store-models;Your choice of AI;Pick the model and how|hard it thinks"
  "07-plan;store-plan;Plan your study;Turn a goal into a plan in|seconds"
)

pixel_size() {
  sips -g pixelWidth -g pixelHeight "$1" | awk '/pixelWidth/ { w = $2 } /pixelHeight/ { h = $2 } END { print w "x" h }'
}

# Returns 3 when the middle of the screen (the web view, right of an iPad sidebar) is one flat color: a fresh simulator
# can leave a web view blank, and such a capture must never become a store image. Any other non-zero status means the
# check itself failed.
web_view_painted() {
  python3 - "$1" <<'PY'
import struct, sys, zlib

data = open(sys.argv[1], "rb").read()
position, idat = 8, []
while position < len(data):
    length, kind = struct.unpack(">I4s", data[position:position + 8])
    chunk = data[position + 8:position + 8 + length]
    if kind == b"IHDR":
        width, height, depth, color, _, _, interlace = struct.unpack(">IIBBBBB", chunk)
        assert depth == 8 and color in (2, 6) and not interlace, "unexpected PNG format"
    elif kind == b"IDAT":
        idat.append(chunk)
    position += 12 + length

step = 3 if color == 2 else 4
stride = width * step
raw = zlib.decompress(b"".join(idat))
previous = bytearray(stride)
colors = {}
for y in range(int(height * 0.75)):
    start = y * (stride + 1)
    kind, line = raw[start], bytearray(raw[start + 1:start + 1 + stride])
    for i in range(stride):
        a = line[i - step] if i >= step else 0
        b = previous[i]
        c = previous[i - step] if i >= step else 0
        if kind == 1:
            line[i] = (line[i] + a) & 255
        elif kind == 2:
            line[i] = (line[i] + b) & 255
        elif kind == 3:
            line[i] = (line[i] + ((a + b) >> 1)) & 255
        elif kind == 4:
            p = a + b - c
            pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
            line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
    previous = line
    if y >= height * 0.2 and y % 4 == 0:
        for x in range(int(width * 0.35), int(width * 0.95), 4):
            key = bytes(line[x * step:x * step + 3])
            colors[key] = colors.get(key, 0) + 1

total = sum(colors.values())
other = 1 - max(colors.values()) / total
print(f"{sys.argv[1]}: {other:.2%} of the web area differs from its background")
sys.exit(0 if other > 0.005 else 3)
PY
}

for entry in "${SHOTS[@]}"; do
  IFS=';' read -r name scene eyebrow title <<<"$entry"
  png="$RAW/$scene.png"
  if [[ ! -f "$png" ]]; then echo "::error::Missing capture $png"; exit 1; fi
  size=$(pixel_size "$png")
  if [[ "$size" != "${WIDTH}x${HEIGHT}" ]]; then echo "::error::$png is $size, expected ${WIDTH}x${HEIGHT}"; exit 1; fi
  if [[ "$scene" == "store-mindmap" || "$scene" == "store-slides" ]]; then
    rc=0
    web_view_painted "$png" || rc=$?
    if (( rc == 3 )); then echo "::error::$png: the web editor is blank"; exit 1; fi
    if (( rc != 0 )); then echo "::error::$png: the blank-page check failed (exit $rc)"; exit 1; fi
  fi
done

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp "$FRAME" "$work/frame.html"
curl -fsSL --retry 3 -o "$work/inter.woff2" "$FONT_URL"
if ! python3 -c 'import hashlib, sys; sys.exit(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest() != sys.argv[2])' \
  "$work/inter.woff2" "$FONT_SHA256"; then
  echo "::error::The downloaded font does not match its pinned checksum."
  exit 1
fi

mkdir -p "$work/out"
for entry in "${SHOTS[@]}"; do
  IFS=';' read -r name scene eyebrow title <<<"$entry"
  cp "$RAW/$scene.png" "$work/$scene.png"
  url=$(python3 -c 'import pathlib, sys, urllib.parse
page = pathlib.Path(sys.argv[1]).resolve().as_uri()
print(page + "?" + urllib.parse.urlencode(dict(zip(("device", "img", "e", "t"), sys.argv[2:]))))' \
    "$work/frame.html" "$DEVICE" "$scene.png" "$eyebrow" "$title")
  if ! "$CHROME" --headless=new --disable-gpu --no-first-run --user-data-dir="$work/chrome" --hide-scrollbars \
    --force-device-scale-factor=1 --window-size="$WIDTH,$HEIGHT" --virtual-time-budget=10000 \
    --screenshot="$work/$name.png" "$url" >"$work/chrome.log" 2>&1 || [[ ! -s "$work/$name.png" ]]; then
    cat "$work/chrome.log"
    echo "::error::Chrome could not render $name"
    exit 1
  fi
  sips -s format jpeg -s formatOptions best "$work/$name.png" --out "$work/out/$name.jpg" >/dev/null
  size=$(pixel_size "$work/out/$name.jpg")
  if [[ "$size" != "${WIDTH}x${HEIGHT}" ]]; then
    echo "::error::$name.jpg is $size, expected ${WIDTH}x${HEIGHT}"
    exit 1
  fi
done

# Only a complete set replaces what is there.
mkdir -p "$OUT"
rm -f "$OUT"/*.jpg
mv "$work/out/"*.jpg "$OUT/"
printf '%s\n' "$OUT"/*.jpg

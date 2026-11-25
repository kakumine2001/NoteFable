#!/usr/bin/env bash
# Fixture-mode screenshots of the Debug simulator build across iOS majors and UI variants.
# Usage: ci-screenshots.sh <NoteFable.app> <out-dir>
# Env: NF_IOS_MAJORS, NF_VARIANTS, NF_SCENES
# Written for macOS /bin/bash (bash 3.2): no mapfile, no associative arrays, no ${var,,}, no sort -V.
set -euo pipefail

APP=${1:?usage: ci-screenshots.sh <NoteFable.app> <out-dir>}
OUT=${2:?usage: ci-screenshots.sh <NoteFable.app> <out-dir>}

read -r -a MAJORS   <<<"${NF_IOS_MAJORS:-26 18}"
read -r -a VARIANTS <<<"${NF_VARIANTS:-light dark ar ar-app rt}"
read -r -a SCENES   <<<"${NF_SCENES:-chat-empty chat chat-streaming drawer workspace editor page-menu search model-sheet attach-sheet settings sign-in}"

DEVICES=("iPhone 16 Pro" "iPhone 17 Pro" "iPhone 17" "iPhone 18 Pro" "iPhone 16")
USER_DEVELOPER_DIR="${DEVELOPER_DIR:-}"
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")

mkdir -p "$OUT/logs"
failed=0
printed_simctl_help=0
ready_summary_file="$OUT/logs/ready-lines.txt"
: >"$ready_summary_file"

# List installed Xcode developer dirs ordered by CFBundleShortVersionString descending.
sorted_developer_dirs() {
  python3 - <<'PY'
import glob, os, plistlib, re

def ver_key(v):
    nums = [int(x) for x in re.findall(r'\d+', v or '0')]
    return tuple(nums)

items = []
for app in glob.glob('/Applications/Xcode*.app'):
    plist_path = os.path.join(app, 'Contents', 'Info.plist')
    ver = '0'
    if os.path.exists(plist_path):
        try:
            with open(plist_path, 'rb') as fh:
                ver = str(plistlib.load(fh).get('CFBundleShortVersionString', '0'))
        except Exception:
            pass
    dev = os.path.join(app, 'Contents', 'Developer')
    if os.path.isdir(dev):
        items.append((ver_key(ver), dev))

items.sort(reverse=True)
for _, dev in items:
    print(dev)
PY
}

runtime_for_current_dev() {
  local major=$1
  xcrun simctl list runtimes -j | jq -r --arg p "com.apple.CoreSimulator.SimRuntime.iOS-${major}-" '
    [.runtimes[] | select(.isAvailable and (.identifier | startswith($p)))]
    | sort_by(.version | split(".") | map(tonumber)) | last | .identifier // empty'
}

select_xcode_for_major() {
  local major=$1 dev rt
  if [[ -n "$USER_DEVELOPER_DIR" ]]; then
    export DEVELOPER_DIR="$USER_DEVELOPER_DIR"
    rt=$(runtime_for_current_dev "$major")
    printf '%s\n' "$rt"
    return 0
  fi
  while IFS= read -r dev; do
    [[ -n "$dev" ]] || continue
    export DEVELOPER_DIR="$dev"
    rt=$(runtime_for_current_dev "$major")
    if [[ -n "$rt" ]]; then
      printf '%s\n' "$rt"
      return 0
    fi
  done < <(sorted_developer_dirs)
  return 0
}

devicetype_for() {
  local runtime=$1 supported name picked=""
  supported=$(xcrun simctl list runtimes -j | jq -r --arg id "$runtime" '
    .runtimes[] | select(.identifier == $id) | .supportedDeviceTypes[]? | "\(.name)\t\(.identifier)"')
  for name in "${DEVICES[@]}"; do
    picked=$(awk -F'\t' -v n="$name" '$1 == n { print $2; exit }' <<<"$supported")
    if [[ -n "$picked" ]]; then
      printf '%s\n' "$picked"
      return 0
    fi
  done
  picked=$(awk -F'\t' '$1 ~ /iPhone/ { print $2; exit }' <<<"$supported")
  if [[ -n "$picked" ]]; then
    printf '%s\n' "$picked"
    return 0
  fi
  return 1
}

boot_device() {
  local udid=$1
  xcrun simctl bootstatus "$udid" -b >/dev/null
  xcrun simctl status_bar "$udid" override \
    --time 9:41 \
    --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 \
    --operatorName '' \
    --batteryState charged --batteryLevel 100
}

launch_scene() {
  local udid=$1 log=$2 scene=$3 variant=$4 force_solid=$5
  local account="signed-in"
  [[ "$scene" == "sign-in" ]] && account="guest"

  local -a args=(-NFFixtures YES -NFFixtureScene "$scene" -NFFixtureAccount "$account")
  case "$variant" in
    ar)
      args+=(-AppleLanguages "(ar)" -AppleLocale ar_SA)
      ;;
    ar-app)
      args+=(-AppleLanguages "(en)" -AppleLocale en_US -NFFixtureAppLanguage ar)
      ;;
    *)
      args+=(-AppleLanguages "(en)" -AppleLocale en_US)
      ;;
  esac
  if [[ "$variant" == "rt" && "$force_solid" == "1" ]]; then
    args+=(-NFForceSolidChrome YES)
  fi

  : >"$log"
  xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl launch --terminate-running-process --stderr="$log" "$udid" "$BUNDLE_ID" "${args[@]}" >/dev/null

  local i
  for i in $(seq 1 120); do
    if grep -q '^NF_FIXTURE_READY ' "$log" 2>/dev/null; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

# Sets appearance & Reduce Transparency. Echoes "1" if -NFForceSolidChrome fallback is needed, else "0".
configure_variant() {
  local udid=$1 major=$2 variant=$3
  local rt=0 probe="$OUT/logs/probe-ios${major}.log"

  if [[ "$variant" == "dark" ]]; then
    xcrun simctl ui "$udid" appearance dark >/dev/null
  else
    xcrun simctl ui "$udid" appearance light >/dev/null
  fi

  [[ "$variant" == "rt" ]] && rt=1
  xcrun simctl spawn "$udid" defaults write com.apple.Accessibility EnhancedBackgroundContrastEnabled -int "$rt" >/dev/null

  if [[ "$rt" -eq 0 ]]; then
    echo "0"
    return 0
  fi

  launch_scene "$udid" "$probe" "chat-empty" "light" "0" || true
  if grep -q 'reduceTransparency=true' "$probe" 2>/dev/null; then
    echo "0"
    return 0
  fi

  # Reboot simulator once so Accessibility preference propagates if required on this runtime.
  xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
  boot_device "$udid" >&2
  launch_scene "$udid" "$probe" "chat-empty" "light" "0" || true
  if grep -q 'reduceTransparency=true' "$probe" 2>/dev/null; then
    echo "0"
    return 0
  fi

  echo "::warning::Reduce Transparency did not reach app via defaults on iOS ${major}; falling back to -NFForceSolidChrome YES for rt variant." >&2
  echo "1"
}

for major in "${MAJORS[@]}"; do
  runtime=$(select_xcode_for_major "$major")
  if [[ -z "$runtime" ]]; then
    echo "::error::No available iOS ${major}.x simulator runtime found."
    xcrun simctl list runtimes || true
    failed=1
    continue
  fi

  echo "=== iOS ${major} using DEVELOPER_DIR=${DEVELOPER_DIR:-default} ==="
  xcodebuild -version || true
  if [[ "$printed_simctl_help" -eq 0 ]]; then
    xcrun simctl help ui || true
    printed_simctl_help=1
  fi

  dtype=$(devicetype_for "$runtime") || {
    echo "::error::No iPhone device type supports ${runtime}."
    failed=1
    continue
  }

  udid=$(xcrun simctl create "NoteFable iOS ${major}" "$dtype" "$runtime")
  echo "Created simulator iOS ${major}: runtime=${runtime}, device=${dtype}, udid=${udid}"
  boot_device "$udid"
  xcrun simctl spawn "$udid" defaults write com.apple.keyboard.preferences DidShowContinuousPathIntroduction -int 1
  xcrun simctl install "$udid" "$APP"

  for variant in "${VARIANTS[@]}"; do
    rt_force_solid=$(configure_variant "$udid" "$major" "$variant")
    mkdir -p "$OUT/ios${major}/${variant}"

    for scene in "${SCENES[@]}"; do
      log="$OUT/logs/ios${major}-${variant}-${scene}.log"
      if launch_scene "$udid" "$log" "$scene" "$variant" "$rt_force_solid"; then
        ready_line=$(grep -m1 '^NF_FIXTURE_READY ' "$log" || true)
        printf 'ios%s\t%s\t%s\t%s\n' "$major" "$variant" "$scene" "$ready_line" >>"$ready_summary_file"
        if [[ "$ready_line" == *"timeout=true"* ]]; then
          echo "::warning::ios${major} ${variant} ${scene} timed out waiting for readiness: ${ready_line}"
        fi
      else
        echo "::error::ios${major} ${variant} ${scene}: missing NF_FIXTURE_READY (app crash or hang)"
        cat "$log" >&2 || true
        failed=1
      fi
      png="$OUT/ios${major}/${variant}/${scene}.png"
      if ! xcrun simctl io "$udid" screenshot --type=png "$png" >/dev/null; then
        echo "::error::Failed to capture screenshot ${png}"
        failed=1
      fi
    done

    if [[ "$variant" == "rt" ]]; then
      xcrun simctl spawn "$udid" defaults write com.apple.Accessibility EnhancedBackgroundContrastEnabled -int 0 || true
    fi
  done

  xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
  xcrun simctl delete "$udid" >/dev/null 2>&1 || true
done

# Report any fixture misses as warnings (never silent).
while IFS= read -r miss; do
  [[ -n "$miss" ]] && echo "::warning::${miss}"
done < <(grep -h '^NF_FIXTURE_MISS ' "$OUT"/logs/*.log 2>/dev/null | sort -u || true)

mkdir -p "$OUT/crashes"
if [[ -d "$HOME/Library/Logs/DiagnosticReports" ]]; then
  find "$HOME/Library/Logs/DiagnosticReports" -name 'NoteFable*' -exec cp {} "$OUT/crashes/" \; 2>/dev/null || true
fi

# Generate contact sheet HTML + GitHub step summary.
python3 - "$OUT" "$ready_summary_file" "${GITHUB_STEP_SUMMARY:-}" <<'PY'
import glob, html, os, sys

out_dir, ready_file, summary_path = sys.argv[1], sys.argv[2], sys.argv[3]

ready_rows = []
if os.path.exists(ready_file):
    with open(ready_file, encoding='utf-8') as fh:
        for line in fh:
            parts = line.rstrip('\n').split('\t', 3)
            if len(parts) == 4:
                ready_rows.append(parts)

majors = sorted([d for d in os.listdir(out_dir) if d.startswith('ios') and os.path.isdir(os.path.join(out_dir, d))])
variants_order = ['light', 'dark', 'ar', 'ar-app', 'rt']
scenes_order = [
    'chat-empty', 'chat', 'chat-streaming', 'drawer', 'workspace',
    'editor', 'page-menu', 'search', 'model-sheet', 'attach-sheet',
    'settings', 'sign-in',
]

parts = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<title>NoteFable iOS Fixture Screenshots</title>',
    '<style>',
    'body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;margin:24px;background:#f7f8fa;color:#111}',
    'h1{margin:0 0 16px} h2{margin:28px 0 12px}',
    'table{border-collapse:collapse;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.08)}',
    'th,td{border:1px solid #e2e5ea;padding:8px;vertical-align:top;text-align:center}',
    'th{background:#f1f3f6;position:sticky;top:0}',
    'th.scene{text-align:left;min-width:130px}',
    'img{width:190px;height:auto;border-radius:12px;border:1px solid #ddd;display:block}',
    '</style></head><body>',
    '<h1>NoteFable iOS Fixture Screenshots</h1>',
]

for major in majors:
    parts.append(f'<h2>{html.escape(major)}</h2>')
    present_variants = [v for v in variants_order if os.path.isdir(os.path.join(out_dir, major, v))]
    for extra in sorted(os.listdir(os.path.join(out_dir, major))):
        if extra not in present_variants and os.path.isdir(os.path.join(out_dir, major, extra)):
            present_variants.append(extra)
    parts.append('<table><thead><tr><th class="scene">Scene</th>')
    for v in present_variants:
        parts.append(f'<th>{html.escape(v)}</th>')
    parts.append('</tr></thead><tbody>')
    for s in scenes_order:
        parts.append(f'<tr><th class="scene">{html.escape(s)}</th>')
        for v in present_variants:
            rel = f'{major}/{v}/{s}.png'
            full = os.path.join(out_dir, rel)
            if os.path.exists(full):
                esc = html.escape(rel)
                parts.append(f'<td><a href="{esc}"><img src="{esc}" loading="lazy" alt="{esc}"></a></td>')
            else:
                parts.append('<td>—</td>')
        parts.append('</tr>')
    parts.append('</tbody></table>')

parts.append('</body></html>')
with open(os.path.join(out_dir, 'index.html'), 'w', encoding='utf-8') as fh:
    fh.write('\n'.join(parts))

if summary_path:
    pngs = sorted(glob.glob(os.path.join(out_dir, 'ios*', '*', '*.png')))
    sample_ready = {}
    for major, variant, scene, line in ready_rows:
        sample_ready.setdefault((major, variant), line)
    with open(summary_path, 'a', encoding='utf-8') as fh:
        fh.write(f'### iOS fixture screenshots ({len(pngs)} PNGs)\n\n')
        if sample_ready:
            fh.write('| Runtime | Variant | Sample READY flags |\n|---|---|---|\n')
            for (major, variant), line in sorted(sample_ready.items()):
                fh.write(f'| `{major}` | `{variant}` | `{line}` |\n')
            fh.write('\n')
PY

exit "$failed"

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
DEFAULT_SCENES="chat-empty chat chat-streaming drawer workspace editor page-menu search model-sheet attach-sheet settings sign-in"
read -r -a SCENES   <<<"${NF_SCENES:-$DEFAULT_SCENES}"

DEVICES=("iPhone 17 Pro" "iPhone 18 Pro" "iPhone 16 Pro" "iPhone 17" "iPhone 16")
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
  local major=$1 json rt
  json=$(xcrun simctl list runtimes -j)
  # Prefer standard single-display runtimes (e.g. SimRuntime.iOS-27-2) before device-specific variants (e.g. iPhone19-4).
  rt=$(jq -r --arg m "$major" '
    [.runtimes[] | select(.isAvailable and (.identifier | test("^com\\.apple\\.CoreSimulator\\.SimRuntime\\.iOS-" + $m + "-[0-9]+$")))]
    | sort_by(.version | split(".") | map(tonumber)) | last | .identifier // empty' <<<"$json")
  if [[ -n "$rt" ]]; then
    printf '%s\n' "$rt"
    return 0
  fi
  jq -r --arg p "com.apple.CoreSimulator.SimRuntime.iOS-${major}-" '
    [.runtimes[] | select(.isAvailable and (.identifier | startswith($p)) and ((.identifier | contains("-iPhone")) or (.identifier | contains("-iPad")) | not))]
    | sort_by(.version | split(".") | map(tonumber)) | last | .identifier // empty' <<<"$json"
}

# Prints "<developer_dir>\t<runtime_identifier>" when a runtime for <major> is found.
select_xcode_for_major() {
  local major=$1 dev rt
  if [[ -n "$USER_DEVELOPER_DIR" ]]; then
    rt=$(DEVELOPER_DIR="$USER_DEVELOPER_DIR" runtime_for_current_dev "$major")
    if [[ -n "$rt" ]]; then
      printf '%s\t%s\n' "$USER_DEVELOPER_DIR" "$rt"
    fi
    return 0
  fi
  while IFS= read -r dev; do
    [[ -n "$dev" ]] || continue
    rt=$(DEVELOPER_DIR="$dev" runtime_for_current_dev "$major")
    if [[ -n "$rt" ]]; then
      printf '%s\t%s\n' "$dev" "$rt"
      return 0
    fi
  done < <(sorted_developer_dirs)
  return 0
}

devicetype_for() {
  local runtime=$1 supported name picked=""
  supported=$(xcrun simctl list runtimes -j | jq -r --arg id "$runtime" '
    .runtimes[] | select(.identifier == $id) | .supportedDeviceTypes[]?
    | select(((.name | contains("Duo")) or (.identifier | contains("Duo"))) | not)
    | "\(.name)\t\(.identifier)"')
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

# Reuses an existing pre-created simulator for this runtime if available, else creates one.
# Prints "<existing|created>\t<udid>\t<device_name_or_type>".
find_or_create_device() {
  local major=$1 runtime=$2 available name udid dtype
  available=$(xcrun simctl list devices -j | jq -r --arg rt "$runtime" '
    (.devices[$rt] // [])[]
    | select(.isAvailable and ((.name | contains("Duo")) or (.deviceTypeIdentifier | contains("Duo")) | not))
    | "\(.name)\t\(.udid)"')
  for name in "${DEVICES[@]}"; do
    udid=$(awk -F'\t' -v n="$name" '$1 == n { print $2; exit }' <<<"$available")
    if [[ -n "$udid" ]]; then
      printf 'existing\t%s\t%s\n' "$udid" "$name"
      return 0
    fi
  done
  udid=$(awk -F'\t' '$1 ~ /iPhone/ { print $2; exit }' <<<"$available")
  if [[ -n "$udid" ]]; then
    name=$(awk -F'\t' -v u="$udid" '$2 == u { print $1; exit }' <<<"$available")
    printf 'existing\t%s\t%s\n' "$udid" "$name"
    return 0
  fi
  dtype=$(devicetype_for "$runtime") || return 1
  udid=$(xcrun simctl create "NoteFable iOS ${major}" "$dtype" "$runtime")
  printf 'created\t%s\t%s\n' "$udid" "$dtype"
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

set_variant_environment() {
  local udid=$1 variant=$2 rt=0
  if [[ "$variant" == "dark" ]]; then
    xcrun simctl ui "$udid" appearance dark >/dev/null
  else
    xcrun simctl ui "$udid" appearance light >/dev/null
  fi
  [[ "$variant" == "rt" ]] && rt=1
  xcrun simctl spawn "$udid" defaults write com.apple.Accessibility EnhancedBackgroundContrastEnabled -int "$rt" >/dev/null
}

wait_for_ready_idx() {
  local log=$1 idx=$2
  local deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    if grep -qE "^NF_FIXTURE_READY idx=${idx}( |$)" "$log" 2>/dev/null; then
      return 0
    fi
    sleep 0.25
  done
  grep -qE "^NF_FIXTURE_READY idx=${idx}( |$)" "$log" 2>/dev/null
}

# Runs one app process for a comma-separated batch of scenes.
# Returns: 0 on completion (even if a scene set failed=1), 2 if rt did not propagate and needs reboot+retry.
run_batch() {
  local udid=$1 major=$2 variant=$3 account=$4 probe_rt=$5
  shift 5
  local -a batch=("$@")
  local csv="" s idx=0 log ack_dir app_data ready_line png

  for s in "${batch[@]}"; do
    if [[ -z "$csv" ]]; then csv="$s"; else csv="${csv},${s}"; fi
  done

  app_data=$(xcrun simctl get_app_container "$udid" "$BUNDLE_ID" data 2>/dev/null || true)
  if [[ -n "$app_data" ]]; then
    ack_dir="${app_data}/tmp/nf-fixture-ack"
  else
    ack_dir="$OUT/ack-ios${major}-${variant}-${account}"
  fi
  rm -rf "$ack_dir"
  mkdir -p "$ack_dir"

  log="$OUT/logs/ios${major}-${variant}-${account}.log"
  : >"$log"

  local -a args=(-NFFixtures YES -NFFixtureBatch "$csv" -NFFixtureAckDir "$ack_dir" -NFFixtureAccount "$account")
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

  xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl launch --terminate-running-process --stderr="$log" "$udid" "$BUNDLE_ID" "${args[@]}" >/dev/null

  for s in "${batch[@]}"; do
    if ! wait_for_ready_idx "$log" "$idx"; then
      echo "::error::ios${major} ${variant} ${s}: missing NF_FIXTURE_READY idx=${idx} (app crash or hang)"
      cat "$log" >&2 || true
      failed=1
      png="$OUT/ios${major}/${variant}/${s}-MISSING.png"
      xcrun simctl io "$udid" screenshot --type=png "$png" >/dev/null || true
      : >"$ack_dir/abort"
      xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
      return 0
    fi

    ready_line=$(grep -m1 -E "^NF_FIXTURE_READY idx=${idx}( |$)" "$log" || true)

    if [[ "$variant" == "rt" && "$account" == "signed-in" && "$idx" -eq 0 ]]; then
      if [[ "$ready_line" != *"reduceTransparency=true"* ]]; then
        : >"$ack_dir/abort"
        xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
        if [[ "$probe_rt" -eq 1 ]]; then
          return 2
        fi
        echo "::error::Reduce Transparency did not reach app on iOS ${major} (${ready_line}); refusing to label un-tinted captures as rt."
        failed=1
        return 3
      fi
    fi

    printf 'ios%s\t%s\t%s\t%s\n' "$major" "$variant" "$s" "$ready_line" >>"$ready_summary_file"

    if [[ "$ready_line" == *"timeout=true"* ]]; then
      echo "::error::ios${major} ${variant} ${s} timed out waiting for readiness: ${ready_line}"
      failed=1
      png="$OUT/ios${major}/${variant}/${s}-TIMEOUT.png"
      xcrun simctl io "$udid" screenshot --type=png "$png" >/dev/null || true
    else
      png="$OUT/ios${major}/${variant}/${s}.png"
      if ! xcrun simctl io "$udid" screenshot --type=png "$png" >/dev/null; then
        echo "::error::Failed to capture screenshot ${png}"
        failed=1
      fi
    fi

    : >"$ack_dir/ack-${idx}"
    idx=$((idx + 1))
  done

  sleep 0.1
  xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  return 0
}

# Partition SCENES into signed-in and guest batches.
declare -a SIGNED_IN_BATCH=()
declare -a GUEST_BATCH=()
if [[ -z "${NF_SCENES:-}" ]]; then
  SIGNED_IN_BATCH=(chat-empty chat model-sheet attach-sheet drawer search settings workspace editor page-menu chat-streaming)
  GUEST_BATCH=(sign-in)
else
  for s in "${SCENES[@]}"; do
    if [[ "$s" == "sign-in" ]]; then
      GUEST_BATCH+=("$s")
    else
      SIGNED_IN_BATCH+=("$s")
    fi
  done
fi

for major in "${MAJORS[@]}"; do
  selection=$(select_xcode_for_major "$major")
  if [[ -z "$selection" ]]; then
    echo "::error::No available iOS ${major}.x simulator runtime found."
    xcrun simctl list runtimes || true
    failed=1
    continue
  fi

  selected_dev=""
  runtime=""
  IFS=$'\t' read -r selected_dev runtime <<<"$selection"
  if [[ -n "$selected_dev" ]]; then
    export DEVELOPER_DIR="$selected_dev"
  fi
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

  device_info=$(find_or_create_device "$major" "$runtime") || {
    echo "::error::No iPhone device type supports ${runtime}."
    failed=1
    continue
  }
  origin=""
  udid=""
  dname=""
  IFS=$'\t' read -r origin udid dname <<<"$device_info"

  boot_start=$(date +%s)
  boot_device "$udid"
  boot_end=$(date +%s)
  echo "Booted simulator iOS ${major} (${origin}: ${dname}, runtime=${runtime}, udid=${udid}) in $((boot_end - boot_start))s"

  xcrun simctl spawn "$udid" defaults write com.apple.keyboard.preferences DidShowContinuousPathIntroduction -int 1
  if [[ "$origin" == "existing" ]]; then
    xcrun simctl uninstall "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  fi
  xcrun simctl install "$udid" "$APP"

  for variant in "${VARIANTS[@]}"; do
    mkdir -p "$OUT/ios${major}/${variant}"
    set_variant_environment "$udid" "$variant"

    rt_ok=1
    if [[ ${#SIGNED_IN_BATCH[@]} -gt 0 ]]; then
      rc=0
      run_batch "$udid" "$major" "$variant" "signed-in" "1" "${SIGNED_IN_BATCH[@]}" || rc=$?
      if [[ "$rc" -eq 2 ]]; then
        echo "Rebooting iOS ${major} simulator so Reduce Transparency preference propagates..."
        xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
        boot_device "$udid"
        set_variant_environment "$udid" "$variant"
        rc=0
        run_batch "$udid" "$major" "$variant" "signed-in" "0" "${SIGNED_IN_BATCH[@]}" || rc=$?
      fi
      if [[ "$rc" -eq 3 ]]; then
        rt_ok=0
      fi
    fi

    if [[ "$rt_ok" -eq 1 && ${#GUEST_BATCH[@]} -gt 0 ]]; then
      rc=0
      run_batch "$udid" "$major" "$variant" "guest" "0" "${GUEST_BATCH[@]}" || rc=$?
    fi

    if [[ "$variant" == "rt" ]]; then
      xcrun simctl spawn "$udid" defaults write com.apple.Accessibility EnhancedBackgroundContrastEnabled -int 0 || true
    fi
  done

  xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
  if [[ "$origin" == "created" ]]; then
    xcrun simctl delete "$udid" >/dev/null 2>&1 || true
  fi
done

# Report any fixture misses as errors (never silent).
while IFS= read -r miss; do
  if [[ -n "$miss" ]]; then
    echo "::error::${miss}"
    failed=1
  fi
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
    'img.fail{border:3px solid #d93025}',
    '.fail-label{color:#d93025;font-size:12px;font-weight:700;margin-top:4px}',
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
            timeout_rel = f'{major}/{v}/{s}-TIMEOUT.png'
            missing_rel = f'{major}/{v}/{s}-MISSING.png'
            if os.path.exists(full):
                esc = html.escape(rel)
                parts.append(f'<td><a href="{esc}"><img src="{esc}" loading="lazy" alt="{esc}"></a></td>')
            elif os.path.exists(os.path.join(out_dir, timeout_rel)):
                esc = html.escape(timeout_rel)
                parts.append(f'<td><a href="{esc}"><img class="fail" src="{esc}" loading="lazy" alt="{esc}"></a><div class="fail-label">TIMEOUT</div></td>')
            elif os.path.exists(os.path.join(out_dir, missing_rel)):
                esc = html.escape(missing_rel)
                parts.append(f'<td><a href="{esc}"><img class="fail" src="{esc}" loading="lazy" alt="{esc}"></a><div class="fail-label">MISSING</div></td>')
            else:
                parts.append('<td>—</td>')
        parts.append('</tr>')
    parts.append('</tbody></table>')

parts.append('</body></html>')
with open(os.path.join(out_dir, 'index.html'), 'w', encoding='utf-8') as fh:
    fh.write('\n'.join(parts))

if summary_path:
    all_pngs = sorted(glob.glob(os.path.join(out_dir, 'ios*', '*', '*.png')))
    ok_pngs = [p for p in all_pngs if not (p.endswith('-TIMEOUT.png') or p.endswith('-MISSING.png'))]
    bad_pngs = [p for p in all_pngs if p.endswith('-TIMEOUT.png') or p.endswith('-MISSING.png')]
    sample_ready = {}
    for major, variant, scene, line in ready_rows:
        sample_ready.setdefault((major, variant), line)
    with open(summary_path, 'a', encoding='utf-8') as fh:
        extra = f' ({len(bad_pngs)} failed diagnostics)' if bad_pngs else ''
        fh.write(f'### iOS fixture screenshots ({len(ok_pngs)} valid PNGs{extra})\n\n')
        if sample_ready:
            fh.write('| Runtime | Variant | Sample READY flags |\n|---|---|---|\n')
            for (major, variant), line in sorted(sample_ready.items()):
                fh.write(f'| `{major}` | `{variant}` | `{line}` |\n')
            fh.write('\n')
PY

exit "$failed"

# shellcheck shell=bash
# Control captures for the blank chat message area on iOS 27. Sourced by ci-screenshots.sh (uses its OUT, BUNDLE_ID,
# failed, boot_device, set_variant_environment and wait_for_ready_idx). The control captures run only when
# NF_CHAT_CONTROL is set; chat_mode_flag also serves NF_CHAT_NORMAL_MODE (the normal screenshots in one mode).
#
# NF_CHAT_CONTROL="off:8 c:8 d:8 e:8": for every mode, the control scenes are taken in order that many times (1-9), light
# appearance. Each scene does its own setup (App/FixtureChatControl.swift). A scene that times out waiting for
# readiness is still captured and marked "timeout" in the report: a warning, the job does not fail.
#   off    current code
#   a      -NFChatListIdentity YES    candidate fix A: a new message list for every conversation
#   b      -NFChatPinPastEnd YES      candidate fix B: signed distance to the bottom, pin when scrolled past the end
#   c      -NFChatBranchIdentity YES  candidate fix C: a new message list when rows of the open chat are replaced
#   d      -NFChatScrollToRow YES     candidate fix D: ScrollViewReader scrolls to the row after such a replacement
#   e      -NFChatStackIdentity YES   candidate fix E: a new LazyVStack (same scroll view) after such a replacement
#   nopin  -NFChatNoPin YES           the scroll controller never pins
# One app process per mode and scene group: the scenes of the first group never open the page editor, and must not
# share a process with the ones that do. NF_CHAT_CONTROL_SCENES takes only the named scenes, as one group.
# NF_CHAT_CONTROL_LIMIT (seconds, default 1080) ends the control captures of a runtime early: a job that runs into its
# own time limit is cancelled and uploads nothing.
# Output: $OUT/chat-control/ios<major>/<mode>/<scene>-<run>.png and $OUT/chat-control/captures.tsv, which
# chat-blank-check.py checks and reports in the step summary.
# Written for macOS /bin/bash (bash 3.2).

CHAT_CONTROL_GROUPS=(
  "chat-switch-visible chat-new-send chat-regenerate"
  "chat-editor-send chat-after-editor chat-streamed-settled chat-editor-link"
)
if [[ -n "${NF_CHAT_CONTROL_SCENES:-}" ]]; then
  CHAT_CONTROL_GROUPS=("$NF_CHAT_CONTROL_SCENES")
fi
CHAT_CONTROL_DEADLINE=0

# chat_mode_flag <mode>: prints the launch argument of the mode (nothing for off); fails on an unknown mode.
chat_mode_flag() {
  case "$1" in
    off) ;;
    a) echo -NFChatListIdentity ;;
    b) echo -NFChatPinPastEnd ;;
    c) echo -NFChatBranchIdentity ;;
    d) echo -NFChatScrollToRow ;;
    e) echo -NFChatStackIdentity ;;
    nopin) echo -NFChatNoPin ;;
    *) return 1 ;;
  esac
}

# run_chat_control <udid> <major>
run_chat_control() {
  local udid=$1 major=$2 spec mode runs group rc probe=1
  CHAT_CONTROL_DEADLINE=$((SECONDS + ${NF_CHAT_CONTROL_LIMIT:-1080}))
  set_variant_environment "$udid" light
  for spec in $NF_CHAT_CONTROL; do
    mode=${spec%%:*}
    runs=1
    if [[ "$spec" == *:* ]]; then runs=${spec#*:}; fi
    for ((group = 0; group < ${#CHAT_CONTROL_GROUPS[@]}; group++)); do
      if (( SECONDS >= CHAT_CONTROL_DEADLINE )); then
        echo "::error::ios${major} chat control ${mode}: group $((group + 1)) skipped, the time limit is used up"
        failed=1
        continue
      fi
      rc=0
      run_chat_control_mode "$udid" "$major" "$mode" "$runs" "$group" "$probe" || rc=$?
      if [[ "$rc" -eq 2 ]]; then
        echo "Rebooting iOS ${major} simulator so Reduce Transparency is off again..."
        xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
        boot_device "$udid"
        set_variant_environment "$udid" light
        probe=0
        run_chat_control_mode "$udid" "$major" "$mode" "$runs" "$group" "$probe" || true
      fi
    done
  done
}

# run_chat_control_mode <udid> <major> <mode> <runs> <group index> <probe>
# Returns 2 (nothing recorded) when probing and the earlier rt variant's Reduce Transparency is still on.
run_chat_control_mode() {
  local udid=$1 major=$2 mode=$3 runs=$4 group=$5 probe=$6
  local -a args=(-NFFixtures YES -NFFixtureAccount signed-in)
  args+=(-AppleLanguages "(en)" -AppleLocale en_US)
  local flag
  if ! flag=$(chat_mode_flag "$mode"); then
    echo "::error::Unknown chat control mode: ${mode}"
    failed=1
    return 0
  fi
  if [[ -n "$flag" ]]; then args+=("$flag" YES); fi
  if ! [[ "$runs" =~ ^[1-9]$ ]]; then
    echo "::error::Chat control ${mode}: runs must be 1-9, not '${runs}'"
    failed=1
    return 0
  fi

  local -a scenes=(${CHAT_CONTROL_GROUPS[$group]})
  local -a batch=()
  local round
  for ((round = 1; round <= runs; round++)); do
    batch+=("${scenes[@]}")
  done
  local csv
  csv=$(IFS=,; echo "${batch[*]}")

  local name app_data ack_dir log shots
  name="ios${major}-control-${mode}-$((group + 1))"
  app_data=$(xcrun simctl get_app_container "$udid" "$BUNDLE_ID" data 2>/dev/null || true)
  if [[ -n "$app_data" ]]; then
    ack_dir="${app_data}/tmp/nf-fixture-ack"
  else
    ack_dir="$OUT/ack-${name}"
  fi
  rm -rf "$ack_dir"
  mkdir -p "$ack_dir"
  log="logs/${name}.log"
  : >"$OUT/$log"
  shots="chat-control/ios${major}/${mode}"
  mkdir -p "$OUT/$shots"

  args+=(-NFFixtureBatch "$csv" -NFFixtureAckDir "$ack_dir")
  local started=$SECONDS
  xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  if ! xcrun simctl launch --terminate-running-process --stderr="$OUT/$log" "$udid" "$BUNDLE_ID" "${args[@]}" >/dev/null; then
    echo "::error::${name}: the app did not launch"
    failed=1
    return 0
  fi

  local scene idx=0 png status ready_line
  for scene in "${batch[@]}"; do
    round=$((idx / ${#scenes[@]} + 1))
    png="${shots}/${scene}-${round}.png"
    rm -f "$OUT/$png"
    if (( SECONDS >= CHAT_CONTROL_DEADLINE )); then
      echo "::error::${name}: stopped before ${scene} run ${round}, the time limit is used up"
      failed=1
      : >"$ack_dir/abort"
      break
    fi
    if ! wait_for_ready_idx "$OUT/$log" "$idx"; then
      echo "::error::${name} ${scene} run ${round}: missing NF_FIXTURE_READY idx=${idx} (app crash or hang)"
      cat "$OUT/$log" >&2 || true
      failed=1
      xcrun simctl io "$udid" screenshot --type=png "$OUT/$png" >/dev/null || true
      printf 'ios%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$major" "$mode" "$round" "$scene" "$idx" "$log" "$png" no-ready \
        >>"$OUT/chat-control/captures.tsv"
      : >"$ack_dir/abort"
      break
    fi
    ready_line=$(grep -m1 -E "^NF_FIXTURE_READY idx=${idx}( |$)" "$OUT/$log" || true)
    if [[ "$idx" -eq 0 && "$ready_line" == *"reduceTransparency=true"* ]]; then
      if [[ "$probe" -eq 1 ]]; then
        : >"$ack_dir/abort"
        xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
        return 2
      fi
      echo "::warning::${name}: Reduce Transparency is still on (${ready_line})"
    fi
    status=ok
    # An unknown scene name is dropped by the app, which would shift every later capture.
    if [[ "$ready_line" != *" scene=${scene} "* ]]; then
      echo "::error::${name}: expected scene ${scene} (${ready_line})"
      failed=1
      status=wrong-scene
    elif [[ "$ready_line" == *"timeout=true"* ]]; then
      echo "::warning::${name} ${scene} run ${round} timed out waiting for readiness"
      status=timeout
    fi
    if ! xcrun simctl io "$udid" screenshot --type=png "$OUT/$png" >/dev/null; then
      echo "::error::Failed to capture screenshot ${OUT}/${png}"
      failed=1
    fi
    printf 'ios%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$major" "$mode" "$round" "$scene" "$idx" "$log" "$png" "$status" \
      >>"$OUT/chat-control/captures.tsv"
    : >"$ack_dir/ack-${idx}"
    idx=$((idx + 1))
  done

  sleep 0.1
  xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  echo "${name}: ${idx} captures in $((SECONDS - started))s"
}

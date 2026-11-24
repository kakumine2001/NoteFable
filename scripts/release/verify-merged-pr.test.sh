#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
verify_script="$script_dir/verify-merged-pr.sh"

tmp_root=$(mktemp -d)
trap 'rm -rf -- "$tmp_root"' EXIT

pass_count=0
fail_count=0
case_idx=0

SHA_A="1111111111111111111111111111111111111111"
SHA_B="2222222222222222222222222222222222222222"

make_mock_gh() {
  local dir="$1"
  local script_path="$dir/mock-gh.sh"
  cat > "$script_path" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state_file="$MOCK_GH_DIR/call_count"
count=0
if [[ -f "$state_file" ]]; then
  count=$(cat "$state_file")
fi
count=$((count + 1))
printf '%s' "$count" > "$state_file"
rc_file="$MOCK_GH_DIR/rc_$count"
out_file="$MOCK_GH_DIR/out_$count"
err_file="$MOCK_GH_DIR/err_$count"
if [[ ! -f "$rc_file" ]]; then
  rc_file="$MOCK_GH_DIR/rc_default"
  out_file="$MOCK_GH_DIR/out_default"
  err_file="$MOCK_GH_DIR/err_default"
fi
if [[ -f "$err_file" ]]; then
  cat "$err_file" >&2
fi
if [[ -f "$out_file" ]]; then
  cat "$out_file"
fi
exit "$(cat "$rc_file")"
EOF
  chmod +x "$script_path"
  printf '%s' "$script_path"
}

run_case() {
  local name="$1" mock_dir="$2" repo="$3" sha="$4" max_attempts="$5" expect_code="$6" expect_is_pr="${7:-}" expect_pr_num="${8:-}" expect_substr="${9:-}"
  case_idx=$((case_idx + 1))
  local out_file="$tmp_root/out-${case_idx}.txt"
  local gh_out="$tmp_root/ghout-${case_idx}.txt"
  : > "$gh_out"

  local mock_gh
  mock_gh=$(make_mock_gh "$mock_dir")

  set +e
  MOCK_GH_DIR="$mock_dir" \
    GH_BIN="$mock_gh" \
    GITHUB_REPOSITORY="$repo" \
    COMMIT_SHA="$sha" \
    TARGET_BRANCH="main" \
    VERIFY_PR_MAX_ATTEMPTS="$max_attempts" \
    VERIFY_PR_RETRY_DELAYS="0" \
    GITHUB_OUTPUT="$gh_out" \
    bash "$verify_script" > "$out_file" 2>&1
  local code=$?
  set -e

  local ok=true
  if (( code != expect_code )); then
    ok=false
    echo "FAIL [$name]: expected exit $expect_code, got $code"
  fi
  if [[ -n "$expect_is_pr" ]]; then
    if ! grep -qx "is_merged_pr=$expect_is_pr" "$gh_out"; then
      ok=false
      echo "FAIL [$name]: expected is_merged_pr=$expect_is_pr, got: $(tr '\n' ';' < "$gh_out")"
    fi
  fi
  if [[ -n "$expect_pr_num" ]]; then
    if ! grep -qx "pr_number=$expect_pr_num" "$gh_out"; then
      ok=false
      echo "FAIL [$name]: expected pr_number=$expect_pr_num, got: $(tr '\n' ';' < "$gh_out")"
    fi
  fi
  if [[ -n "$expect_substr" ]]; then
    if ! grep -Fq "$expect_substr" "$out_file"; then
      ok=false
      echo "FAIL [$name]: expected output containing '$expect_substr', got: $(cat "$out_file")"
    fi
  fi

  if [[ "$ok" == true ]]; then
    pass_count=$((pass_count + 1))
    echo "PASS [$name]"
  else
    fail_count=$((fail_count + 1))
    echo "  output: $(cat "$out_file")"
  fi
}

# 1. Matching merged PR on first attempt (case-insensitive SHA and repo)
d="$tmp_root/c1"; mkdir -p "$d"
echo 0 > "$d/rc_default"
cat > "$d/out_default" <<EOF
[[{"number":180,"state":"closed","merged_at":"2026-11-24T08:17:47Z","merge_commit_sha":"$(echo "$SHA_A" | tr 'a-f' 'A-F')","base":{"ref":"main","repo":{"full_name":"KakuMine2001/notefable"}}}]]
EOF
run_case "matching merged PR on attempt 1" "$d" "kakumine2001/NoteFable" "$SHA_A" 3 0 "true" "180" "merged pull request #180"

# 2. Paginated response where match is on second page
d="$tmp_root/c2"; mkdir -p "$d"
echo 0 > "$d/rc_default"
cat > "$d/out_default" <<EOF
[[{"number":100,"state":"closed","merged_at":"2026-11-20T00:00:00Z","merge_commit_sha":"$SHA_B","base":{"ref":"main","repo":{"full_name":"kakumine2001/NoteFable"}}}],[{"number":205,"state":"closed","merged_at":"2026-11-24T09:00:00Z","merge_commit_sha":"$SHA_A","base":{"ref":"main","repo":{"full_name":"kakumine2001/NoteFable"}}}]]
EOF
run_case "paginated match on page 2" "$d" "kakumine2001/NoteFable" "$SHA_A" 2 0 "true" "205" "merged pull request #205"

# 3. Indexing lag: empty on attempt 1, match on attempt 2
d="$tmp_root/c3"; mkdir -p "$d"
echo 0 > "$d/rc_1"; echo '[[]]' > "$d/out_1"
echo 0 > "$d/rc_2"
cat > "$d/out_2" <<EOF
[[{"number":181,"state":"closed","merged_at":"2026-11-24T09:01:00Z","merge_commit_sha":"$SHA_A","base":{"ref":"main","repo":{"full_name":"kakumine2001/NoteFable"}}}]]
EOF
run_case "indexing lag recovered on retry" "$d" "kakumine2001/NoteFable" "$SHA_A" 3 0 "true" "181" "merged pull request #181"

# 4. Direct push (empty array on all attempts) -> is_merged_pr=false, exit 0
d="$tmp_root/c4"; mkdir -p "$d"
echo 0 > "$d/rc_default"; echo '[[]]' > "$d/out_default"
run_case "direct push skipped" "$d" "kakumine2001/NoteFable" "$SHA_A" 2 0 "false" "" "Skipping release"

# 5. Non-merge commit that belongs to a PR (merge_commit_sha does not match)
d="$tmp_root/c5"; mkdir -p "$d"
echo 0 > "$d/rc_default"
cat > "$d/out_default" <<EOF
[[{"number":180,"state":"closed","merged_at":"2026-11-24T08:17:47Z","merge_commit_sha":"$SHA_B","base":{"ref":"main","repo":{"full_name":"kakumine2001/NoteFable"}}}]]
EOF
run_case "PR branch commit not merge commit skipped" "$d" "kakumine2001/NoteFable" "$SHA_A" 2 0 "false" "" "Skipping release"

# 6. PR merged to a different base branch -> skipped
d="$tmp_root/c6"; mkdir -p "$d"
echo 0 > "$d/rc_default"
cat > "$d/out_default" <<EOF
[[{"number":182,"state":"closed","merged_at":"2026-11-24T08:17:47Z","merge_commit_sha":"$SHA_A","base":{"ref":"develop","repo":{"full_name":"kakumine2001/NoteFable"}}}]]
EOF
run_case "PR targeting non-main branch skipped" "$d" "kakumine2001/NoteFable" "$SHA_A" 2 0 "false" "" "Skipping release"

# 7. Closed unmerged PR (merged_at null) -> skipped
d="$tmp_root/c7"; mkdir -p "$d"
echo 0 > "$d/rc_default"
cat > "$d/out_default" <<EOF
[[{"number":183,"state":"closed","merged_at":null,"merge_commit_sha":"$SHA_A","base":{"ref":"main","repo":{"full_name":"kakumine2001/NoteFable"}}}]]
EOF
run_case "closed unmerged PR skipped" "$d" "kakumine2001/NoteFable" "$SHA_A" 2 0 "false" "" "Skipping release"

# 8. Transient API error on attempt 1, succeeds on attempt 2
d="$tmp_root/c8"; mkdir -p "$d"
echo 1 > "$d/rc_1"; echo "HTTP 502 Bad Gateway" > "$d/err_1"
echo 0 > "$d/rc_2"
cat > "$d/out_2" <<EOF
[[{"number":184,"state":"closed","merged_at":"2026-11-24T09:13:06Z","merge_commit_sha":"$SHA_A","base":{"ref":"main","repo":{"full_name":"kakumine2001/NoteFable"}}}]]
EOF
run_case "transient API error recovered on retry" "$d" "kakumine2001/NoteFable" "$SHA_A" 3 0 "true" "184" "merged pull request #184"

# 9. Persistent API error -> fails closed (exit 1)
d="$tmp_root/c9"; mkdir -p "$d"
echo 1 > "$d/rc_default"; echo "HTTP 500 Internal Server Error" > "$d/err_default"
run_case "persistent API error fails closed" "$d" "kakumine2001/NoteFable" "$SHA_A" 2 1 "" "" "Failed to verify"

# 10. Attempt 1 empty, attempt 2 API error -> fails closed (does not falsely skip)
d="$tmp_root/c10"; mkdir -p "$d"
echo 0 > "$d/rc_1"; echo '[[]]' > "$d/out_1"
echo 1 > "$d/rc_2"; echo "network timeout" > "$d/err_2"
run_case "empty then API error fails closed" "$d" "kakumine2001/NoteFable" "$SHA_A" 2 1 "" "" "Failed to verify"

# 11. Invalid JSON payload -> fails closed
d="$tmp_root/c11"; mkdir -p "$d"
echo 0 > "$d/rc_default"; echo 'not-json' > "$d/out_default"
run_case "invalid JSON fails closed" "$d" "kakumine2001/NoteFable" "$SHA_A" 2 1 "" "" "Failed to verify"

# 12. Invalid COMMIT_SHA -> exits 1 immediately
d="$tmp_root/c12"; mkdir -p "$d"
echo 0 > "$d/rc_default"; echo '[[]]' > "$d/out_default"
run_case "invalid SHA rejected" "$d" "kakumine2001/NoteFable" "not-a-sha" 2 1 "" "" "COMMIT_SHA must be a 40-character commit SHA"

echo "---"
echo "Passed: $pass_count, Failed: $fail_count"
(( fail_count == 0 ))

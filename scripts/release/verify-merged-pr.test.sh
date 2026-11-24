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

# Route mock gh calls by endpoint kind (commit_pulls, direct_pr, recent_pulls) and per-kind call counter.
make_mock_gh() {
  local dir="$1"
  local script_path="$dir/mock-gh.sh"
  cat > "$script_path" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
endpoint="${!#}"
kind="other"
if [[ "$endpoint" == *"/commits/"*"/pulls"* ]]; then
  kind="commit_pulls"
elif [[ "$endpoint" =~ /pulls/[0-9]+$ ]]; then
  kind="direct_pr"
elif [[ "$endpoint" == *"/pulls?"* ]]; then
  kind="recent_pulls"
fi

state_file="$MOCK_GH_DIR/count_${kind}"
count=0
if [[ -f "$state_file" ]]; then
  count=$(cat "$state_file")
fi
count=$((count + 1))
printf '%s' "$count" > "$state_file"

pick_file() {
  local prefix="$1"
  if [[ -f "$MOCK_GH_DIR/${prefix}_${kind}_${count}" ]]; then
    printf '%s' "$MOCK_GH_DIR/${prefix}_${kind}_${count}"
  elif [[ -f "$MOCK_GH_DIR/${prefix}_${kind}" ]]; then
    printf '%s' "$MOCK_GH_DIR/${prefix}_${kind}"
  elif [[ -f "$MOCK_GH_DIR/${prefix}_${count}" ]]; then
    printf '%s' "$MOCK_GH_DIR/${prefix}_${count}"
  elif [[ -f "$MOCK_GH_DIR/${prefix}_default" ]]; then
    printf '%s' "$MOCK_GH_DIR/${prefix}_default"
  fi
}

rc_file=$(pick_file rc)
out_file=$(pick_file out)
err_file=$(pick_file err)

if [[ -n "$err_file" ]]; then
  cat "$err_file" >&2
fi
if [[ -n "$out_file" ]]; then
  cat "$out_file"
fi
if [[ -n "$rc_file" ]]; then
  exit "$(cat "$rc_file")"
fi
echo "[]"
exit 0
EOF
  chmod +x "$script_path"
  printf '%s' "$script_path"
}

run_case() {
  local name="$1" mock_dir="$2" repo="$3" sha="$4" max_attempts="$5" expect_code="$6" expect_is_pr="${7:-}" expect_pr_num="${8:-}" expect_substr="${9:-}" commit_subject="${10:-}" workdir="${11:-$tmp_root}"
  case_idx=$((case_idx + 1))
  local out_file="$tmp_root/out-${case_idx}.txt"
  local gh_out="$tmp_root/ghout-${case_idx}.txt"
  : > "$gh_out"

  local mock_gh
  mock_gh=$(make_mock_gh "$mock_dir")

  set +e
  if [[ "$commit_subject" == "__USE_GIT__" ]]; then
    (cd "$workdir" && MOCK_GH_DIR="$mock_dir" \
      GH_BIN="$mock_gh" \
      GITHUB_REPOSITORY="$repo" \
      COMMIT_SHA="$sha" \
      TARGET_BRANCH="main" \
      VERIFY_PR_MAX_ATTEMPTS="$max_attempts" \
      VERIFY_PR_RETRY_DELAYS="0" \
      GITHUB_OUTPUT="$gh_out" \
      bash "$verify_script") > "$out_file" 2>&1
  else
    (cd "$workdir" && MOCK_GH_DIR="$mock_dir" \
      GH_BIN="$mock_gh" \
      GITHUB_REPOSITORY="$repo" \
      COMMIT_SHA="$sha" \
      COMMIT_SUBJECT="$commit_subject" \
      TARGET_BRANCH="main" \
      VERIFY_PR_MAX_ATTEMPTS="$max_attempts" \
      VERIFY_PR_RETRY_DELAYS="0" \
      GITHUB_OUTPUT="$gh_out" \
      bash "$verify_script") > "$out_file" 2>&1
  fi
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
echo 0 > "$d/rc_commit_pulls"
cat > "$d/out_commit_pulls" <<EOF
[[{"number":180,"state":"closed","merged_at":"2026-11-24T08:17:47Z","merge_commit_sha":"$(echo "$SHA_A" | tr 'a-f' 'A-F')","base":{"ref":"main","repo":{"full_name":"KakuMine2001/notefable"}}}]]
EOF
run_case "matching merged PR on attempt 1" "$d" "kakumine2001/NoteFable" "$SHA_A" 3 0 "true" "180" "merged pull request #180"

# 2. Paginated response where match is on second page
d="$tmp_root/c2"; mkdir -p "$d"
echo 0 > "$d/rc_commit_pulls"
cat > "$d/out_commit_pulls" <<EOF
[[{"number":100,"state":"closed","merged_at":"2026-11-20T00:00:00Z","merge_commit_sha":"$SHA_B","base":{"ref":"main","repo":{"full_name":"kakumine2001/NoteFable"}}}],[{"number":205,"state":"closed","merged_at":"2026-11-24T09:00:00Z","merge_commit_sha":"$SHA_A","base":{"ref":"main","repo":{"full_name":"kakumine2001/NoteFable"}}}]]
EOF
run_case "paginated match on page 2" "$d" "kakumine2001/NoteFable" "$SHA_A" 2 0 "true" "205" "merged pull request #205"

# 3. Stale commit-to-PR index recovered via direct PR lookup from git merge commit subject
repo_dir="$tmp_root/git-merge-repo"
mkdir -p "$repo_dir"
git -C "$repo_dir" init -q -b main
git -C "$repo_dir" config user.email "test@example.com"
git -C "$repo_dir" config user.name "Test"
git -C "$repo_dir" config commit.gpgsign false
echo "x" > "$repo_dir/a.txt"
git -C "$repo_dir" add a.txt
git -C "$repo_dir" commit -q -m "Merge pull request #185 from kakumine2001/ci/fix"
real_sha=$(git -C "$repo_dir" rev-parse HEAD)
d="$tmp_root/c3"; mkdir -p "$d"
echo 0 > "$d/rc_commit_pulls"; echo '[[]]' > "$d/out_commit_pulls"
echo 0 > "$d/rc_direct_pr"
cat > "$d/out_direct_pr" <<EOF
{"number":185,"state":"closed","merged_at":"2026-11-24T09:20:00Z","merge_commit_sha":"$real_sha","base":{"ref":"main","repo":{"full_name":"kakumine2001/NoteFable"}}}
EOF
run_case "stale index recovered via direct PR lookup from git subject" "$d" "kakumine2001/NoteFable" "$real_sha" 1 0 "true" "185" "via direct PR lookup" "__USE_GIT__" "$repo_dir"

# 4. Stale commit-to-PR index with custom merge subject recovered via recent closed PRs
d="$tmp_root/c4"; mkdir -p "$d"
echo 0 > "$d/rc_commit_pulls"; echo '[[]]' > "$d/out_commit_pulls"
echo 0 > "$d/rc_recent_pulls"
cat > "$d/out_recent_pulls" <<EOF
[{"number":186,"state":"closed","merged_at":"2026-11-24T09:21:00Z","merge_commit_sha":"$SHA_A","base":{"ref":"main","repo":{"full_name":"kakumine2001/NoteFable"}}}]
EOF
run_case "stale index with custom subject recovered via recent closed PRs" "$d" "kakumine2001/NoteFable" "$SHA_A" 1 0 "true" "186" "via recent closed PRs" "Custom merge title"

# 5. Direct push with forged PR number (404 on direct PR lookup) -> skipped cleanly
d="$tmp_root/c5"; mkdir -p "$d"
echo 0 > "$d/rc_commit_pulls"; echo '[[]]' > "$d/out_commit_pulls"
echo 1 > "$d/rc_direct_pr"; echo "gh: Not Found (HTTP 404)" > "$d/err_direct_pr"
echo 0 > "$d/rc_recent_pulls"; echo '[]' > "$d/out_recent_pulls"
run_case "direct push with forged non-existent PR number skipped" "$d" "kakumine2001/NoteFable" "$SHA_A" 2 0 "false" "" "Skipping release" "Merge pull request #999999 from attacker/branch"

# 6. Direct push with forged existing PR number (mismatched merge_commit_sha) -> skipped cleanly
d="$tmp_root/c6"; mkdir -p "$d"
echo 0 > "$d/rc_commit_pulls"; echo '[[]]' > "$d/out_commit_pulls"
echo 0 > "$d/rc_direct_pr"
cat > "$d/out_direct_pr" <<EOF
{"number":180,"state":"closed","merged_at":"2026-11-24T08:17:47Z","merge_commit_sha":"$SHA_B","base":{"ref":"main","repo":{"full_name":"kakumine2001/NoteFable"}}}
EOF
echo 0 > "$d/rc_recent_pulls"; echo '[]' > "$d/out_recent_pulls"
run_case "direct push spoofing existing PR number skipped" "$d" "kakumine2001/NoteFable" "$SHA_A" 2 0 "false" "" "Skipping release" "Merge pull request #180 from someone/branch"

# 7. Indexing lag across all endpoints on attempt 1, recovered on attempt 2
d="$tmp_root/c7"; mkdir -p "$d"
echo 0 > "$d/rc_commit_pulls_1"; echo '[[]]' > "$d/out_commit_pulls_1"
echo 0 > "$d/rc_recent_pulls_1"; echo '[]' > "$d/out_recent_pulls_1"
echo 0 > "$d/rc_commit_pulls_2"
cat > "$d/out_commit_pulls_2" <<EOF
[[{"number":181,"state":"closed","merged_at":"2026-11-24T09:01:00Z","merge_commit_sha":"$SHA_A","base":{"ref":"main","repo":{"full_name":"kakumine2001/NoteFable"}}}]]
EOF
run_case "indexing lag recovered on retry" "$d" "kakumine2001/NoteFable" "$SHA_A" 3 0 "true" "181" "merged pull request #181"

# 8. Direct push (empty array on all attempts) -> is_merged_pr=false, exit 0
d="$tmp_root/c8"; mkdir -p "$d"
echo 0 > "$d/rc_commit_pulls"; echo '[[]]' > "$d/out_commit_pulls"
echo 0 > "$d/rc_recent_pulls"; echo '[]' > "$d/out_recent_pulls"
run_case "direct push skipped" "$d" "kakumine2001/NoteFable" "$SHA_A" 2 0 "false" "" "Skipping release"

# 9. PR merged to a different base branch -> skipped
d="$tmp_root/c9"; mkdir -p "$d"
echo 0 > "$d/rc_commit_pulls"
cat > "$d/out_commit_pulls" <<EOF
[[{"number":182,"state":"closed","merged_at":"2026-11-24T08:17:47Z","merge_commit_sha":"$SHA_A","base":{"ref":"develop","repo":{"full_name":"kakumine2001/NoteFable"}}}]]
EOF
echo 0 > "$d/rc_recent_pulls"; echo '[]' > "$d/out_recent_pulls"
run_case "PR targeting non-main branch skipped" "$d" "kakumine2001/NoteFable" "$SHA_A" 2 0 "false" "" "Skipping release"

# 10. Closed unmerged PR (merged_at null) -> skipped
d="$tmp_root/c10"; mkdir -p "$d"
echo 0 > "$d/rc_commit_pulls"
cat > "$d/out_commit_pulls" <<EOF
[[{"number":183,"state":"closed","merged_at":null,"merge_commit_sha":"$SHA_A","base":{"ref":"main","repo":{"full_name":"kakumine2001/NoteFable"}}}]]
EOF
echo 0 > "$d/rc_recent_pulls"; echo '[]' > "$d/out_recent_pulls"
run_case "closed unmerged PR skipped" "$d" "kakumine2001/NoteFable" "$SHA_A" 2 0 "false" "" "Skipping release"

# 11. Primary API error on attempt 1, direct PR lookup still succeeds on attempt 1
d="$tmp_root/c11"; mkdir -p "$d"
echo 1 > "$d/rc_commit_pulls"; echo "HTTP 502 Bad Gateway" > "$d/err_commit_pulls"
echo 0 > "$d/rc_direct_pr"
cat > "$d/out_direct_pr" <<EOF
{"number":184,"state":"closed","merged_at":"2026-11-24T09:13:06Z","merge_commit_sha":"$SHA_A","base":{"ref":"main","repo":{"full_name":"kakumine2001/NoteFable"}}}
EOF
run_case "primary API error recovered by direct PR lookup" "$d" "kakumine2001/NoteFable" "$SHA_A" 2 0 "true" "184" "via direct PR lookup" "Merge pull request #184 from kakumine2001/fix"

# 12. Persistent API error -> fails closed (exit 1)
d="$tmp_root/c12"; mkdir -p "$d"
echo 1 > "$d/rc_default"; echo "HTTP 500 Internal Server Error" > "$d/err_default"
run_case "persistent API error fails closed" "$d" "kakumine2001/NoteFable" "$SHA_A" 2 1 "" "" "Failed to verify"

# 13. Primary empty, fallback API error -> fails closed (does not falsely skip)
d="$tmp_root/c13"; mkdir -p "$d"
echo 0 > "$d/rc_commit_pulls"; echo '[[]]' > "$d/out_commit_pulls"
echo 1 > "$d/rc_recent_pulls"; echo "HTTP 503 Service Unavailable" > "$d/err_recent_pulls"
run_case "fallback API error fails closed" "$d" "kakumine2001/NoteFable" "$SHA_A" 2 1 "" "" "Failed to verify"

# 14. Direct PR lookup 500 error -> fails closed (only 404 is treated as non-match)
d="$tmp_root/c14"; mkdir -p "$d"
echo 0 > "$d/rc_commit_pulls"; echo '[[]]' > "$d/out_commit_pulls"
echo 1 > "$d/rc_direct_pr"; echo "HTTP 500 Internal Server Error" > "$d/err_direct_pr"
echo 0 > "$d/rc_recent_pulls"; echo '[]' > "$d/out_recent_pulls"
run_case "direct PR 500 error fails closed" "$d" "kakumine2001/NoteFable" "$SHA_A" 2 1 "" "" "Failed to verify" "Merge pull request #184 from kakumine2001/fix"

# 15. Invalid JSON payload -> fails closed
d="$tmp_root/c15"; mkdir -p "$d"
echo 0 > "$d/rc_default"; echo 'not-json' > "$d/out_default"
run_case "invalid JSON fails closed" "$d" "kakumine2001/NoteFable" "$SHA_A" 2 1 "" "" "Failed to verify"

# 16. Invalid COMMIT_SHA -> exits 1 immediately
d="$tmp_root/c16"; mkdir -p "$d"
echo 0 > "$d/rc_default"; echo '[[]]' > "$d/out_default"
run_case "invalid SHA rejected" "$d" "kakumine2001/NoteFable" "not-a-sha" 2 1 "" "" "COMMIT_SHA must be a 40-character commit SHA"

echo "---"
echo "Passed: $pass_count, Failed: $fail_count"
(( fail_count == 0 ))

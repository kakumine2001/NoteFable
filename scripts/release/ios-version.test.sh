#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
version_script="$script_dir/ios-version.sh"

tmp_root=$(mktemp -d)
trap 'rm -rf -- "$tmp_root"' EXIT

pass_count=0
fail_count=0

write_project() {
  local dir="$1" marketing="$2" build="$3" extra="${4:-}"
  mkdir -p "$dir/mobile/ios"
  cat > "$dir/mobile/ios/project.yml" <<EOF
name: NoteFable
settings:
  base:
    SWIFT_VERSION: "5.0"
    MARKETING_VERSION: $marketing
    CURRENT_PROJECT_VERSION: $build
    ENABLE_USER_SCRIPT_SANDBOXING: YES
$extra
EOF
}

init_repo() {
  local dir="$1"
  mkdir -p "$dir"
  git -C "$dir" init -q -b main
  git -C "$dir" config core.autocrlf false
  git -C "$dir" config commit.gpgsign false
  git -C "$dir" config user.email "test@example.com"
  git -C "$dir" config user.name "Test"
  echo "readme" > "$dir/README.md"
  git -C "$dir" add README.md
  git -C "$dir" commit -q -m "init"
}

run_case() {
  local name="$1" repo="$2" expect_code="$3" expect_publish="${4:-}" expect_build="${5:-}" expect_substr="${6:-}" expect_marketing="${7:-}"
  local out_file="$tmp_root/out-${pass_count}-${fail_count}.txt"
  local gh_out="$tmp_root/ghout-${pass_count}-${fail_count}.txt"
  : > "$gh_out"

  set +e
  (cd "$repo" && GITHUB_OUTPUT="$gh_out" bash "$version_script") > "$out_file" 2>&1
  local code=$?
  set -e

  local ok=true
  if (( code != expect_code )); then
    ok=false
    echo "FAIL [$name]: expected exit $expect_code, got $code"
  fi
  if [[ -n "$expect_publish" ]]; then
    if ! grep -qx "publish=$expect_publish" "$gh_out"; then
      ok=false
      echo "FAIL [$name]: expected GITHUB_OUTPUT publish=$expect_publish, got: $(tr '\n' ';' < "$gh_out")"
    fi
  fi
  if [[ -n "$expect_build" ]]; then
    if ! grep -qx "build_number=$expect_build" "$gh_out"; then
      ok=false
      echo "FAIL [$name]: expected GITHUB_OUTPUT build_number=$expect_build, got: $(tr '\n' ';' < "$gh_out")"
    fi
  fi
  if [[ -n "$expect_marketing" ]]; then
    if ! grep -qx "marketing_version=$expect_marketing" "$gh_out"; then
      ok=false
      echo "FAIL [$name]: expected GITHUB_OUTPUT marketing_version=$expect_marketing, got: $(tr '\n' ';' < "$gh_out")"
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

# 1. Non-merge commit fails
r="$tmp_root/non-merge"
init_repo "$r"
run_case "non-merge commit" "$r" 1 "" "" "not a merge commit"

# 2. Neither HEAD^1 nor HEAD has project.yml -> skip
r="$tmp_root/no-project"
init_repo "$r"
git -C "$r" checkout -q -b pr
echo "doc" >> "$r/README.md"
git -C "$r" commit -q -am "doc"
git -C "$r" checkout -q main
git -C "$r" merge -q --no-ff pr -m "merge pr"
run_case "no project.yml yet" "$r" 0 "false" "" "not present yet"

# 3. Initial project.yml introduction -> valid, publish=false
r="$tmp_root/initial-project"
init_repo "$r"
git -C "$r" checkout -q -b pr
write_project "$r" '"0.1.0"' '"1"'
git -C "$r" add mobile/ios/project.yml
git -C "$r" commit -q -m "add ios project"
git -C "$r" checkout -q main
git -C "$r" merge -q --no-ff pr -m "merge ios project"
run_case "initial project.yml introduction" "$r" 0 "false" "" "Initial mobile/ios/project.yml introduced"

# 4. Initial project.yml with invalid build number -> fails
r="$tmp_root/initial-invalid"
init_repo "$r"
git -C "$r" checkout -q -b pr
write_project "$r" '"0.1.0"' '"0"'
git -C "$r" add mobile/ios/project.yml
git -C "$r" commit -q -m "bad initial ios project"
git -C "$r" checkout -q main
git -C "$r" merge -q --no-ff pr -m "merge bad ios project"
run_case "initial project.yml invalid build" "$r" 1 "" "" "CURRENT_PROJECT_VERSION"

# 5. Removing project.yml -> fails
r="$tmp_root/remove-project"
init_repo "$r"
write_project "$r" '"0.1.0"' '"1"'
git -C "$r" add mobile/ios/project.yml
git -C "$r" commit -q -m "add ios project"
git -C "$r" checkout -q -b pr
git -C "$r" rm -q mobile/ios/project.yml
git -C "$r" commit -q -m "remove ios project"
git -C "$r" checkout -q main
git -C "$r" merge -q --no-ff pr -m "merge removal"
run_case "remove project.yml" "$r" 1 "" "" "was removed"

# 6. Unchanged version -> skip (publish=false)
r="$tmp_root/unchanged"
init_repo "$r"
write_project "$r" '"0.1.0"' '"1"'
git -C "$r" add mobile/ios/project.yml
git -C "$r" commit -q -m "add ios project"
git -C "$r" checkout -q -b pr
echo "change" >> "$r/README.md"
git -C "$r" commit -q -am "web change"
git -C "$r" checkout -q main
git -C "$r" merge -q --no-ff pr -m "merge web change"
run_case "unchanged version" "$r" 0 "false" "" "unchanged (1)"

# 7. Build number bump under same MARKETING_VERSION -> publish=true
r="$tmp_root/build-only-bump"
init_repo "$r"
write_project "$r" '"0.1.0"' '"1"'
git -C "$r" add mobile/ios/project.yml
git -C "$r" commit -q -m "add ios project"
git -C "$r" checkout -q -b pr
write_project "$r" '"0.1.0"' '"2"'
git -C "$r" commit -q -am "bump build 2"
git -C "$r" checkout -q main
git -C "$r" merge -q --no-ff pr -m "merge build 2"
run_case "build-only bump (same MARKETING_VERSION)" "$r" 0 "true" "2" "0.1.0 (1) -> 0.1.0 (2)" "0.1.0"

# 8. Build + MARKETING_VERSION bump (including 0.9.0 -> 0.10.0) -> publish=true
r="$tmp_root/both-bump"
init_repo "$r"
write_project "$r" '"0.9.0"' '"9"'
git -C "$r" add mobile/ios/project.yml
git -C "$r" commit -q -m "add ios project"
git -C "$r" checkout -q -b pr
write_project "$r" '"0.10.0"' '"10"'
git -C "$r" commit -q -am "bump 0.10.0 (10)"
git -C "$r" checkout -q main
git -C "$r" merge -q --no-ff pr -m "merge 0.10.0"
run_case "build + marketing version bump (0.9.0 -> 0.10.0)" "$r" 0 "true" "10" "0.9.0 (9) -> 0.10.0 (10)" "0.10.0"

# 9. Decreasing MARKETING_VERSION while increasing build -> fails
r="$tmp_root/marketing-decrease"
init_repo "$r"
write_project "$r" '"0.2.0"' '"2"'
git -C "$r" add mobile/ios/project.yml
git -C "$r" commit -q -m "add ios project"
git -C "$r" checkout -q -b pr
write_project "$r" '"0.1.9"' '"3"'
git -C "$r" commit -q -am "regress marketing version"
git -C "$r" checkout -q main
git -C "$r" merge -q --no-ff pr -m "merge regress"
run_case "marketing version decrease" "$r" 1 "" "" "MARKETING_VERSION must not decrease"

# 10. Updating MARKETING_VERSION without bumping build -> fails
r="$tmp_root/marketing-only"
init_repo "$r"
write_project "$r" '"0.1.0"' '"2"'
git -C "$r" add mobile/ios/project.yml
git -C "$r" commit -q -m "add ios project"
git -C "$r" checkout -q -b pr
write_project "$r" '"0.2.0"' '"2"'
git -C "$r" commit -q -am "marketing only"
git -C "$r" checkout -q main
git -C "$r" merge -q --no-ff pr -m "merge marketing only"
run_case "marketing version change without build bump" "$r" 1 "" "" "Increase CURRENT_PROJECT_VERSION"

# 11. Decreasing build number -> fails
r="$tmp_root/build-decrease"
init_repo "$r"
write_project "$r" '"0.1.0"' '"3"'
git -C "$r" add mobile/ios/project.yml
git -C "$r" commit -q -m "add ios project"
git -C "$r" checkout -q -b pr
write_project "$r" '"0.1.0"' '"2"'
git -C "$r" commit -q -am "decrease build"
git -C "$r" checkout -q main
git -C "$r" merge -q --no-ff pr -m "merge decrease"
run_case "build number decrease" "$r" 1 "" "" "CURRENT_PROJECT_VERSION must not decrease"

# 12. Leading zero / invalid build number -> fails
r="$tmp_root/invalid-build"
init_repo "$r"
write_project "$r" '"0.1.0"' '"1"'
git -C "$r" add mobile/ios/project.yml
git -C "$r" commit -q -m "add ios project"
git -C "$r" checkout -q -b pr
write_project "$r" '"0.1.0"' '"02"'
git -C "$r" commit -q -am "leading zero"
git -C "$r" checkout -q main
git -C "$r" merge -q --no-ff pr -m "merge leading zero"
run_case "leading zero build number" "$r" 1 "" "" "CURRENT_PROJECT_VERSION"

# 13. Duplicate CURRENT_PROJECT_VERSION -> fails
r="$tmp_root/duplicate-build"
init_repo "$r"
write_project "$r" '"0.1.0"' '"1"'
git -C "$r" add mobile/ios/project.yml
git -C "$r" commit -q -m "add ios project"
git -C "$r" checkout -q -b pr
write_project "$r" '"0.1.0"' '"2"' '    CURRENT_PROJECT_VERSION: "3"'
git -C "$r" commit -q -am "duplicate key"
git -C "$r" checkout -q main
git -C "$r" merge -q --no-ff pr -m "merge duplicate"
run_case "duplicate CURRENT_PROJECT_VERSION" "$r" 1 "" "" "CURRENT_PROJECT_VERSION"

# 14. Parallel bump conflict (both main and PR bumped 1 -> 2) -> fails
r="$tmp_root/parallel-bump"
init_repo "$r"
write_project "$r" '"0.1.0"' '"1"'
git -C "$r" add mobile/ios/project.yml
git -C "$r" commit -q -m "base 1"
git -C "$r" checkout -q -b pr
write_project "$r" '"0.1.0"' '"2"'
git -C "$r" commit -q -am "pr bumps to 2"
git -C "$r" checkout -q main
write_project "$r" '"0.1.0"' '"2"'
git -C "$r" commit -q -am "main bumps to 2"
git -C "$r" merge -q --no-ff pr -m "merge parallel bump"
run_case "parallel bump conflict" "$r" 1 "" "" "main already has 2"

# 15. PR branched before project.yml existed -> skip
r="$tmp_root/old-pr-base"
init_repo "$r"
git -C "$r" checkout -q -b pr
echo "old branch change" >> "$r/README.md"
git -C "$r" commit -q -am "old branch change"
git -C "$r" checkout -q main
write_project "$r" '"0.1.0"' '"1"'
git -C "$r" add mobile/ios/project.yml
git -C "$r" commit -q -m "main adds ios project"
git -C "$r" merge -q --no-ff pr -m "merge old branch"
run_case "PR branched before project.yml existed" "$r" 0 "false" "" "unchanged (1)"

# 16. Single quotes, unquoted int, inline comments, commented line, CRLF -> works
r="$tmp_root/yaml-variants"
init_repo "$r"
write_project "$r" "'0.1.0'" "1 # initial" '    # CURRENT_PROJECT_VERSION: "99"'
git -C "$r" add mobile/ios/project.yml
git -C "$r" commit -q -m "base variants"
git -C "$r" checkout -q -b pr
printf 'name: NoteFable\r\nsettings:\r\n  base:\r\n    # CURRENT_PROJECT_VERSION: "88"\r\n    MARKETING_VERSION: '\''0.1.1'\'' # patch\r\n    CURRENT_PROJECT_VERSION: 2 # tf build\r\n' > "$r/mobile/ios/project.yml"
git -C "$r" commit -q -am "bump with crlf and comments"
git -C "$r" checkout -q main
git -C "$r" merge -q --no-ff pr -m "merge variants"
run_case "YAML quotes/comments/CRLF variants" "$r" 0 "true" "2" "0.1.0 (1) -> 0.1.1 (2)" "0.1.1"

# 16b. Overlong MARKETING_VERSION (>18 chars) -> fails
r="$tmp_root/overlong-marketing"
init_repo "$r"
write_project "$r" '"0.1.0"' '"1"'
git -C "$r" add mobile/ios/project.yml
git -C "$r" commit -q -m "add ios project"
git -C "$r" checkout -q -b pr
write_project "$r" '"12345678.12345678.12"' '"2"'
git -C "$r" commit -q -am "overlong marketing version"
git -C "$r" checkout -q main
git -C "$r" merge -q --no-ff pr -m "merge overlong"
run_case "overlong MARKETING_VERSION rejected" "$r" 1 "" "" "MARKETING_VERSION"

# 17. --parse-build stdin helper (valid and invalid)
parsed=$(printf 'settings:\n  base:\n    # CURRENT_PROJECT_VERSION: "9"\n    CURRENT_PROJECT_VERSION: "42" # ok\n' | bash "$version_script" --parse-build)
if [[ "$parsed" == "42" ]]; then
  pass_count=$((pass_count + 1))
  echo "PASS [--parse-build valid]"
else
  fail_count=$((fail_count + 1))
  echo "FAIL [--parse-build valid]: expected 42, got '$parsed'"
fi

set +e
printf 'settings:\n  base:\n    CURRENT_PROJECT_VERSION: "42\n' | bash "$version_script" --parse-build > /dev/null 2>&1
bad_parse_code=$?
set -e
if (( bad_parse_code != 0 )); then
  pass_count=$((pass_count + 1))
  echo "PASS [--parse-build unclosed quote rejected]"
else
  fail_count=$((fail_count + 1))
  echo "FAIL [--parse-build unclosed quote rejected]: expected non-zero exit"
fi

set +e
printf 'settings:\n  base:\n    CURRENT_PROJECT_VERSION: "42"\n    CURRENT_PROJECT_VERSION: ""\n' | bash "$version_script" --parse-build > /dev/null 2>&1
dup_empty_code=$?
set -e
if (( dup_empty_code != 0 )); then
  pass_count=$((pass_count + 1))
  echo "PASS [--parse-build duplicate with trailing empty value rejected]"
else
  fail_count=$((fail_count + 1))
  echo "FAIL [--parse-build duplicate with trailing empty value rejected]: expected non-zero exit"
fi

echo "---"
echo "Passed: $pass_count, Failed: $fail_count"
(( fail_count == 0 ))

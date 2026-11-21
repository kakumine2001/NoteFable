#!/usr/bin/env bash
set -euo pipefail
# Compares the iOS version of a PR merge (HEAD) with main before the merge (HEAD^1); HEAD^2 is the PR head.
# Runs on GitHub's test merge in iOS PR checks and on the real merge commit in the release workflow.
# Needs full history (fetch-depth: 0) for the merge base. The repository allows only merge-commit merges.
# Also supports `--parse-build` (reads project.yml from stdin and prints the validated CURRENT_PROJECT_VERSION).

config=mobile/ios/project.yml

write_output() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s\n' "$1" >> "$GITHUB_OUTPUT"
  fi
}

extract_yaml_setting() {
  local key="$1"
  tr -d '\r' | awk -v key="$key" -v sq="'" '
    BEGIN { count = 0; result = "" }
    {
      line = $0
      if (line ~ /^[[:space:]]*#/) next
      if (match(line, "^[[:space:]]*" key "[[:space:]]*:[[:space:]]*")) {
        count++
        val = substr(line, RSTART + RLENGTH)
        first = substr(val, 1, 1)
        if (first == "\"" || first == sq) {
          rest = substr(val, 2)
          idx = index(rest, first)
          if (idx == 0) {
            result = "__INVALID__"
            next
          }
          after_q = substr(rest, idx + 1)
          if (after_q !~ /^[[:space:]]*(#.*)?$/) {
            result = "__INVALID__"
            next
          }
          result = substr(rest, 1, idx - 1)
        } else {
          sub(/[[:space:]]+#.*$/, "", val)
          sub(/[[:space:]]+$/, "", val)
          result = val
        }
        if (result == "") result = "__EMPTY__"
      }
    }
    END {
      if (count == 1) {
        print result
      } else if (count > 1) {
        print "__DUPLICATE__"
      }
    }
  '
}

valid_build() {
  [[ -n "$1" && "$1" != *$'\n'* && "$1" =~ ^[1-9][0-9]{0,8}$ ]]
}

valid_marketing_version() {
  [[ -n "$1" && ${#1} -le 18 && "$1" != *$'\n'* && "$1" =~ ^(0|[1-9][0-9]{0,8})(\.(0|[1-9][0-9]{0,8})){1,2}$ ]]
}

if [[ "${1:-}" == "--parse-build" ]]; then
  val=$(extract_yaml_setting CURRENT_PROJECT_VERSION)
  if ! valid_build "$val"; then
    echo "::error::Expected a single positive integer CURRENT_PROJECT_VERSION in $config." >&2
    exit 1
  fi
  printf '%s\n' "$val"
  exit 0
fi

if (( $# > 0 )); then
  echo "::error::Unknown argument: $1" >&2
  exit 1
fi

has_config() {
  git cat-file -e "$1:$config" 2> /dev/null
}

build_number() {
  git show "$1:$config" | extract_yaml_setting CURRENT_PROJECT_VERSION
}

marketing_version() {
  git show "$1:$config" | extract_yaml_setting MARKETING_VERSION
}

version_lt() {
  local IFS=.
  local -a a b
  read -r -a a <<< "$1"
  read -r -a b <<< "$2"
  local i ai bi
  for i in 0 1 2; do
    ai=${a[i]:-0}
    bi=${b[i]:-0}
    if (( 10#$ai < 10#$bi )); then
      return 0
    elif (( 10#$ai > 10#$bi )); then
      return 1
    fi
  done
  return 1
}

git rev-parse --verify --quiet HEAD^2 > /dev/null || {
  echo "::error::HEAD is not a merge commit. The version check needs the PR merge (HEAD^1 = main, HEAD^2 = PR head); merge PRs with a merge commit."
  exit 1
}

had_before=false
has_after=false
has_config HEAD^1 && had_before=true
has_config HEAD && has_after=true

if [[ "$had_before" == false && "$has_after" == false ]]; then
  echo "$config is not present yet. No App Store Connect release is planned."
  write_output 'publish=false'
  exit 0
fi

if [[ "$had_before" == true && "$has_after" == false ]]; then
  echo "::error::$config was removed from HEAD."
  exit 1
fi

after=$(build_number HEAD)
new_name=$(marketing_version HEAD)
if ! valid_build "$after"; then
  echo "::error::Expected a single positive integer CURRENT_PROJECT_VERSION in $config at HEAD."
  exit 1
fi
if ! valid_marketing_version "$new_name"; then
  echo "::error::Expected a single valid MARKETING_VERSION (e.g. 0.1.0) in $config at HEAD."
  exit 1
fi

if [[ "$had_before" == false && "$has_after" == true ]]; then
  echo "Initial $config introduced at $new_name ($after). Bump CURRENT_PROJECT_VERSION in a follow-up PR to publish to TestFlight."
  write_output 'publish=false'
  exit 0
fi

before=$(build_number HEAD^1)
old_name=$(marketing_version HEAD^1)
if ! valid_build "$before"; then
  echo "::error::Expected a single positive integer CURRENT_PROJECT_VERSION in $config at HEAD^1."
  exit 1
fi
if ! valid_marketing_version "$old_name"; then
  echo "::error::Expected a single valid MARKETING_VERSION (e.g. 0.1.0) in $config at HEAD^1."
  exit 1
fi

if (( after < before )); then
  echo "::error::iOS CURRENT_PROJECT_VERSION must not decrease ($before -> $after)."
  exit 1
fi

if version_lt "$new_name" "$old_name"; then
  echo "::error::iOS MARKETING_VERSION must not decrease ($old_name -> $new_name)."
  exit 1
fi

if (( after == before )); then
  if [[ "$new_name" != "$old_name" ]]; then
    echo "::error::Increase CURRENT_PROJECT_VERSION when updating MARKETING_VERSION ($old_name -> $new_name)."
    exit 1
  fi

  # The PR may have bumped the build number to a value that main already reached through another PR.
  base=$(git merge-base HEAD^1 HEAD^2) || {
    echo "::error::No merge base between main and the PR head. Check out the full history (fetch-depth: 0)."
    exit 1
  }
  # A PR branched before mobile/ios/project.yml existed has no config at its merge base or head,
  # so it cannot have bumped this version.
  if ! has_config "$base" || ! has_config HEAD^2; then
    echo "CURRENT_PROJECT_VERSION is unchanged ($after). No App Store Connect release is planned."
    write_output 'publish=false'
    exit 0
  fi

  pr_before=$(build_number "$base")
  pr_after=$(build_number HEAD^2)
  if ! valid_build "$pr_before" || ! valid_build "$pr_after"; then
    echo "::error::Expected a single positive integer CURRENT_PROJECT_VERSION at the PR head and its merge base."
    exit 1
  fi
  if [[ "$pr_before" != "$pr_after" ]]; then
    echo "::error::This PR changes CURRENT_PROJECT_VERSION, but main already has $after. Raise it above $after or revert the version change."
    exit 1
  fi

  echo "CURRENT_PROJECT_VERSION is unchanged ($after). No App Store Connect release is planned."
  write_output 'publish=false'
  exit 0
fi

# App Store Connect / TestFlight allows multiple strictly increasing builds under the same MARKETING_VERSION.
echo "iOS version $old_name ($before) -> $new_name ($after). App Store Connect / TestFlight release is planned for $(git rev-parse HEAD)."
write_output "build_number=$after"
write_output "marketing_version=$new_name"
write_output 'publish=true'

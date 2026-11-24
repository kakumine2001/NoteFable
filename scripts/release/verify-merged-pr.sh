#!/usr/bin/env bash
set -euo pipefail
# Verifies that COMMIT_SHA (default: GITHUB_SHA) is the merge commit of a merged PR
# targeting TARGET_BRANCH (default: main) in GITHUB_REPOSITORY.
# Used by release workflows on `push` to `main` so direct pushes never trigger a release.
# Retries briefly to tolerate GitHub API indexing lag right after a merge, and fails
# closed if the API query itself cannot succeed.

repo="${GITHUB_REPOSITORY:-}"
sha="${COMMIT_SHA:-${GITHUB_SHA:-}}"
target_branch="${TARGET_BRANCH:-main}"
gh_bin="${GH_BIN:-gh}"
max_attempts="${VERIFY_PR_MAX_ATTEMPTS:-4}"
retry_delays_str="${VERIFY_PR_RETRY_DELAYS:-2 4 6}"

write_output() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s\n' "$1" >> "$GITHUB_OUTPUT"
  fi
}

if [[ ! "$repo" =~ ^[^/[:space:]]+/[^/[:space:]]+$ ]]; then
  echo "::error::GITHUB_REPOSITORY must be in owner/repo format (got '${repo}')."
  exit 1
fi

if [[ ! "$sha" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "::error::COMMIT_SHA must be a 40-character commit SHA (got '${sha}')."
  exit 1
fi

if [[ -z "$target_branch" ]]; then
  echo "::error::TARGET_BRANCH must not be empty."
  exit 1
fi

if [[ ! "$max_attempts" =~ ^[1-9][0-9]*$ ]]; then
  echo "::error::VERIFY_PR_MAX_ATTEMPTS must be a positive integer (got '${max_attempts}')."
  exit 1
fi

python_bin=$(command -v python3 || command -v python || true)
if [[ -z "$python_bin" ]]; then
  echo "::error::python3 (or python) is required to parse pull request JSON."
  exit 1
fi

retry_delays=()
if [[ -n "$retry_delays_str" ]]; then
  read -r -a retry_delays <<< "$retry_delays_str"
fi

api_err=$(mktemp)
trap 'rm -f -- "$api_err"' EXIT

find_matching_pr() {
  "$python_bin" -c '
import json, sys

sha = sys.argv[1].lower()
repo = sys.argv[2].lower()
target_branch = sys.argv[3]

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(2)

if not isinstance(data, list):
    sys.exit(2)

prs = []
for item in data:
    if isinstance(item, list):
        for sub in item:
            if not isinstance(sub, dict):
                sys.exit(2)
            prs.append(sub)
    elif isinstance(item, dict):
        prs.append(item)
    else:
        sys.exit(2)

matches = []
for pr in prs:
    if pr.get("state") != "closed":
        continue
    if not pr.get("merged_at"):
        continue
    merge_sha = pr.get("merge_commit_sha")
    if not isinstance(merge_sha, str) or merge_sha.lower() != sha:
        continue
    base = pr.get("base")
    if not isinstance(base, dict) or base.get("ref") != target_branch:
        continue
    base_repo = base.get("repo")
    if not isinstance(base_repo, dict):
        continue
    full_name = base_repo.get("full_name")
    if not isinstance(full_name, str) or full_name.lower() != repo:
        continue
    num = pr.get("number")
    if isinstance(num, int) and not isinstance(num, bool) and num > 0:
        matches.append(num)

if matches:
    matches.sort()
    print(matches[0])
' "$sha" "$repo" "$target_branch"
}

last_succeeded=false
for (( attempt = 1; attempt <= max_attempts; attempt++ )); do
  : > "$api_err"
  set +e
  payload=$("$gh_bin" api --paginate --slurp "repos/$repo/commits/$sha/pulls?per_page=100" 2>"$api_err")
  api_rc=$?
  set -e

  if (( api_rc == 0 )); then
    set +e
    pr_number=$(printf '%s' "$payload" | find_matching_pr)
    parse_rc=$?
    set -e

    if (( parse_rc == 0 )); then
      last_succeeded=true
      if [[ -n "$pr_number" ]]; then
        echo "Confirmed commit $sha is merged pull request #$pr_number targeting $target_branch."
        write_output 'is_merged_pr=true'
        write_output "pr_number=$pr_number"
        exit 0
      fi
    else
      last_succeeded=false
      echo "Attempt $attempt/$max_attempts: invalid JSON payload from GitHub API." >&2
    fi
  else
    last_succeeded=false
    err_text=$(tr '\n' ' ' < "$api_err")
    echo "Attempt $attempt/$max_attempts: GitHub API query failed (exit $api_rc): $err_text" >&2
  fi

  if (( attempt < max_attempts )); then
    delay=0
    delay_idx=$(( attempt - 1 ))
    if (( ${#retry_delays[@]} > 0 )); then
      if (( delay_idx < ${#retry_delays[@]} )); then
        delay="${retry_delays[$delay_idx]}"
      else
        delay="${retry_delays[${#retry_delays[@]}-1]}"
      fi
    fi
    if [[ "$delay" =~ ^[0-9]+$ ]] && (( delay > 0 )); then
      sleep "$delay"
    fi
  fi
done

if [[ "$last_succeeded" != true ]]; then
  echo "::error::Failed to verify whether commit $sha is a merged pull request after $max_attempts attempts."
  exit 1
fi

echo "::notice::Commit $sha is not a merged pull request targeting $target_branch. Skipping release."
write_output 'is_merged_pr=false'

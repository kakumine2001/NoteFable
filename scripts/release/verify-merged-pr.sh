#!/usr/bin/env bash
set -euo pipefail
# Verifies that COMMIT_SHA (default: GITHUB_SHA) is the merge commit of a merged PR
# targeting TARGET_BRANCH (default: main) in GITHUB_REPOSITORY.
# Used by release workflows on `push` to `main` (and manual replay) so direct pushes
# never trigger a release.
#
# Lookup order per attempt:
#   1. Commit-to-PR index: GET /repos/{owner}/{repo}/commits/{sha}/pulls
#   2. Direct PR lookup (if commit subject is "Merge pull request #<N> ..."):
#      GET /repos/{owner}/{repo}/pulls/<N>  (primary-key lookup; immune to index lag)
#   3. Recent closed PRs targeting TARGET_BRANCH:
#      GET /repos/{owner}/{repo}/pulls?state=closed&base=<branch>&sort=updated&direction=desc&per_page=30
# Every lookup verifies the same GitHub-authoritative PR fields (closed, merged_at,
# merge_commit_sha == COMMIT_SHA, base.ref == TARGET_BRANCH, base.repo.full_name == repo).
# Fails closed if any required API query cannot succeed.

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

# Extract optional candidate PR number from a standard GitHub merge commit subject.
# Even if forged in a direct push, the direct PR endpoint still requires GitHub's
# merge_commit_sha, merged_at, base.ref, and base.repo.full_name to match.
if [[ -n "${COMMIT_SUBJECT+x}" ]]; then
  commit_subject="$COMMIT_SUBJECT"
else
  commit_subject=$(git show -s --format=%s "$sha" 2>/dev/null || true)
fi
candidate_pr=""
if [[ "$commit_subject" =~ ^Merge\ pull\ request\ \#([1-9][0-9]*)([^0-9]|$) ]]; then
  candidate_pr="${BASH_REMATCH[1]}"
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

prs = []
if isinstance(data, dict):
    prs.append(data)
elif isinstance(data, list):
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

# Queries a GitHub API endpoint and parses PR JSON.
# Sets global query_pr (matching PR number or empty) and returns:
#   0 = API succeeded and JSON was valid
#   1 = API or JSON error (caller must treat attempt as failed)
query_pr=""
query_endpoint() {
  local allow_404="$1"
  shift
  query_pr=""
  : > "$api_err"
  set +e
  local payload
  payload=$("$gh_bin" api "$@" 2>"$api_err")
  local api_rc=$?
  set -e

  if (( api_rc != 0 )); then
    local err_text
    err_text=$(tr '\n' ' ' < "$api_err")
    if [[ "$allow_404" == "true" && "$err_text" == *"HTTP 404"* ]]; then
      return 0
    fi
    echo "Attempt $attempt/$max_attempts: GitHub API query failed (exit $api_rc): $err_text" >&2
    return 1
  fi

  set +e
  query_pr=$(printf '%s' "$payload" | find_matching_pr)
  local parse_rc=$?
  set -e
  if (( parse_rc != 0 )); then
    query_pr=""
    echo "Attempt $attempt/$max_attempts: invalid JSON payload from GitHub API." >&2
    return 1
  fi
  return 0
}

encoded_branch=$("$python_bin" -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$target_branch")

last_succeeded=false
for (( attempt = 1; attempt <= max_attempts; attempt++ )); do
  attempt_ok=true

  # 1. Primary lookup: commit-to-PR index.
  if query_endpoint false --paginate --slurp "repos/$repo/commits/$sha/pulls?per_page=100"; then
    if [[ -n "$query_pr" ]]; then
      echo "Confirmed commit $sha is merged pull request #$query_pr targeting $target_branch."
      write_output 'is_merged_pr=true'
      write_output "pr_number=$query_pr"
      exit 0
    fi
  else
    attempt_ok=false
  fi

  # 2. Direct PR lookup from merge commit subject (immune to commit-to-PR index lag).
  if [[ -n "$candidate_pr" ]]; then
    if query_endpoint true "repos/$repo/pulls/$candidate_pr"; then
      if [[ -n "$query_pr" ]]; then
        echo "Confirmed commit $sha is merged pull request #$query_pr targeting $target_branch (via direct PR lookup)."
        write_output 'is_merged_pr=true'
        write_output "pr_number=$query_pr"
        exit 0
      fi
    else
      attempt_ok=false
    fi
  fi

  # 3. Fallback for customized merge commit subjects when commit-to-PR index is lagging.
  if query_endpoint false "repos/$repo/pulls?state=closed&base=$encoded_branch&sort=updated&direction=desc&per_page=30"; then
    if [[ -n "$query_pr" ]]; then
      echo "Confirmed commit $sha is merged pull request #$query_pr targeting $target_branch (via recent closed PRs)."
      write_output 'is_merged_pr=true'
      write_output "pr_number=$query_pr"
      exit 0
    fi
  else
    attempt_ok=false
  fi

  last_succeeded="$attempt_ok"

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

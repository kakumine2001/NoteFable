set -euo pipefail
# Compares the Android version of a merge commit (HEAD) with main before the merge (HEAD^1).
# Runs on the PR's test merge in Android PR checks and on the real merge commit in the release workflow.
# Needs full history (fetch-depth: 0) for the merge base.
config=mobile/android/app/build.gradle.kts
version_code() {
  git show "$1:$config" | sed -nE 's/^[[:space:]]*versionCode[[:space:]]*=[[:space:]]*([0-9]+)[[:space:]]*$/\1/p'
}
version_name() {
  git show "$1:$config" | sed -nE 's/^[[:space:]]*versionName[[:space:]]*=[[:space:]]*"([^"]+)"[[:space:]]*$/\1/p'
}
valid_code() {
  [[ "$1" =~ ^[1-9][0-9]{0,9}$ ]]
}
git rev-parse --verify --quiet HEAD^2 > /dev/null || {
  echo "::error::Android releases need a PR merged with a merge commit (squash and rebase merges are not supported)."
  exit 1
}
before=$(version_code HEAD^1)
after=$(version_code HEAD)
if ! valid_code "$before" || ! valid_code "$after"; then
  echo "::error::Expected a single positive versionCode in each Gradle config."
  exit 1
fi
if (( after > 2100000000 || after < before )); then
  echo "::error::Android versionCode must not decrease or exceed the Google Play limit."
  exit 1
fi
if (( after == before )); then
  # The PR may have bumped the version to a value that main already reached through another PR.
  base=$(git merge-base HEAD^1 HEAD^2)
  if [[ "$(version_code "$base")" != "$(version_code HEAD^2)" ]]; then
    echo "::error::This PR changes versionCode, but main already has versionCode $after. Raise it above $after or revert the version change."
    exit 1
  fi
  echo "versionCode is unchanged ($after). No Play alpha release is planned."
  exit 0
fi
old_name=$(version_name HEAD^1)
new_name=$(version_name HEAD)
if [[ -z "$old_name" || -z "$new_name" || "$old_name" == *$'\n'* || "$new_name" == *$'\n'* || "$new_name" == "$old_name" ]]; then
  echo "::error::Update versionName when increasing versionCode."
  exit 1
fi
echo "versionCode $before -> $after. Play alpha release is planned for $(git rev-parse HEAD)."
echo "version_code=$after" >> "$GITHUB_OUTPUT"
echo 'publish=true' >> "$GITHUB_OUTPUT"

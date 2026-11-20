set -euo pipefail
config=mobile/android/app/build.gradle.kts
version_code() {
  git show "$1:$config" | sed -nE 's/^[[:space:]]*versionCode[[:space:]]*=[[:space:]]*([0-9]+)[[:space:]]*$/\1/p'
}
before=$(version_code HEAD^1)
after=$(version_code HEAD)
if ! [[ "$before" =~ ^[1-9][0-9]{0,9}$ && "$after" =~ ^[1-9][0-9]{0,9}$ ]]; then
  echo "::error::Expected a single positive versionCode in each Gradle config."
  exit 1
fi
if (( after > 2100000000 || after < before )); then
  echo "::error::Android versionCode must not decrease or exceed the Google Play limit."
  exit 1
fi
if (( after == before )); then
  echo "versionCode is unchanged ($after). No Play alpha release is planned."
  exit 0
fi
git rev-parse --verify --quiet HEAD^2 > /dev/null || {
  echo "::error::An Android release requires a PR merged with a merge commit."
  exit 1
}
echo "versionCode $before -> $after. Play alpha release is planned for $(git rev-parse HEAD)."
version_name() {
  git show "$1:$config" | sed -nE 's/^[[:space:]]*versionName[[:space:]]*=[[:space:]]*"([^"]+)"[[:space:]]*$/\1/p'
}
old_name=$(version_name HEAD^1)
new_name=$(version_name HEAD)
if [[ -z "$old_name" || -z "$new_name" || "$old_name" == *$'\n'* || "$new_name" == *$'\n'* || "$new_name" == "$old_name" ]]; then
  echo "::error::Update versionName when increasing versionCode."
  exit 1
fi
echo "version_code=$after" >> "$GITHUB_OUTPUT"
echo 'publish=true' >> "$GITHUB_OUTPUT"

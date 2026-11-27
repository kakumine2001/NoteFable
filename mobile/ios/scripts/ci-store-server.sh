#!/usr/bin/env bash
# CI App Store screenshots (macOS runner): serves this checkout's web editor on a throwaway local Postgres and seeds
# the two pages of mobile/ios/app-store/seed/ that the app opens as fx-store-board and fx-store-deck.
# Usage: ci-store-server.sh <work-dir>
#   <work-dir>/editor-cookie  anonymous device cookie that owns the seeded pages (-NFEditorCookie); written last
#   <work-dir>/web.log        output of next start
# The web server keeps running after the script exits (CI: until the job ends).
# Env: NF_WEB_PORT (3000), NF_PG_PORT (5432). No production database, no AI or Blob keys, no repository secrets.
# Written for macOS /bin/bash (bash 3.2).
set -euo pipefail

WORK=${1:?usage: ci-store-server.sh <work-dir>}
mkdir -p "$WORK"
WORK=$(cd "$WORK" && pwd)
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
SEED="$ROOT/mobile/ios/app-store/seed"
WEB_PORT=${NF_WEB_PORT:-3000}
PG_PORT=${NF_PG_PORT:-5432}
BASE="http://localhost:${WEB_PORT}"
rm -f "$WORK/editor-cookie"

# A local trust-auth cluster that only lives for this job; the cookie secret is made up for each run.
export DATABASE_URL="postgresql://$(whoami)@localhost:${PG_PORT}/notefable"
export NEXT_TELEMETRY_DISABLED=1
COOKIE_SECRET=$(openssl rand -hex 32)
export COOKIE_SECRET

HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install postgresql@18
PGBIN="$(brew --prefix postgresql@18)/bin"
"$PGBIN/initdb" --auth=trust --encoding=UTF8 --locale=C -D "$WORK/pg" >"$WORK/initdb.log"
"$PGBIN/pg_ctl" -D "$WORK/pg" -l "$WORK/postgres.log" -o "-p ${PG_PORT} -c listen_addresses=localhost" -w start
"$PGBIN/createdb" -h localhost -p "$PG_PORT" notefable

cd "$ROOT"
npm ci
npm run prisma:migrate
npm run build
nohup npx next start -p "$WEB_PORT" >"$WORK/web.log" 2>&1 &
web_pid=$!
echo "$web_pid" >"$WORK/web.pid"

for _ in $(seq 1 120); do
  if curl -fsS -o /dev/null "$BASE/note-embed" 2>/dev/null; then break; fi
  if ! kill -0 "$web_pid" 2>/dev/null; then
    echo "::error::next start exited"
    cat "$WORK/web.log"
    exit 1
  fi
  sleep 1
done
curl -fsS -o /dev/null "$BASE/note-embed"

# The server issues the anonymous device cookie (src/lib/auth.ts) and that user creates both pages, so the product
# validates them like any other save.
cookie=$(curl -fsS -D - -o /dev/null "$BASE/api/pages" | tr -d '\r' |
  sed -n 's/^[Ss]et-[Cc]ookie: notefable_device=\([^;]*\).*/\1/p')
cookie=${cookie%%$'\n'*}
if [[ -z "$cookie" ]]; then
  echo "::error::No notefable_device cookie from $BASE/api/pages"
  exit 1
fi

# POSTs one seed file and prints the new page id.
create_page() {
  curl -fsS -X POST "$BASE/api/pages" -H 'Content-Type: application/json' -H "Cookie: notefable_device=$cookie" \
    --data-binary "@$1" |
    node -e 'let s = ""; process.stdin.on("data", (d) => { s += d; }).on("end", () => {
      const id = JSON.parse(s).page.id;
      if (!/^[a-z0-9]+$/i.test(id)) process.exit(1);
      process.stdout.write(id);
    });'
}
board=$(create_page "$SEED/mindmap.json")
deck=$(create_page "$SEED/deck.json")

# The app addresses the two pages by fixed ids (FixtureStoreData.IDs). Every foreign key to NotePage cascades on update.
"$PGBIN/psql" "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
  -c "UPDATE notefable.\"NotePage\" SET id = 'fx-store-board' WHERE id = '$board'" \
  -c "UPDATE notefable.\"NotePage\" SET id = 'fx-store-deck' WHERE id = '$deck'"
for id in fx-store-board fx-store-deck; do
  curl -fsS -o /dev/null -H "Cookie: notefable_device=$cookie" "$BASE/api/pages/$id"
done

(umask 077 && printf '%s' "$cookie" >"$WORK/editor-cookie")
echo "Store editor server ready on $BASE"

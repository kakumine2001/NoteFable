#!/usr/bin/env bash
# 在 Linux Swift 容器里编译 / 测试 NoteFable/Core。源码目录只读挂在 /src，构建目录挂在 /build（用具名卷留住缓存）。
#
#   docker run --rm -v "<仓库>/mobile/ios:/src:ro" -v nf-ios-build:/build swift:6.1 bash /src/scripts/core-check.sh test
#
# 只检查一部分（别的文件还没写完时）：ONLY 是相对 NoteFable/ 的目录或文件，TESTS 是测试文件名，都用空格分开。
#   -e ONLY="Core/Networking Core/Models" -e TESTS="NoteFableApiTests.swift"
# 参数原样交给 swift（默认 test），例如：build、test --filter ActivityTests。
set -euo pipefail

SRC=/src
WORK=/build/work
rm -rf "$WORK"
mkdir -p "$WORK/NoteFable/Core" "$WORK/Tests/NoteFableCoreTests/Fixtures"
cp "$SRC/Package.swift" "$WORK/"

if [ -z "${ONLY:-}" ]; then
  cp -r "$SRC/NoteFable/Core/." "$WORK/NoteFable/Core/"
  cp -r "$SRC/Tests/NoteFableCoreTests/." "$WORK/Tests/NoteFableCoreTests/"
else
  for p in Core/Support/JSONValue.swift Core/Text/L10n.swift $ONLY; do
    mkdir -p "$WORK/NoteFable/$(dirname "$p")"
    cp -r "$SRC/NoteFable/$p" "$WORK/NoteFable/$(dirname "$p")/"
  done
  cp -r "$SRC/Tests/NoteFableCoreTests/Fixtures/." "$WORK/Tests/NoteFableCoreTests/Fixtures/"
  for t in L10nTests.swift ${TESTS:-}; do
    cp -r "$SRC/Tests/NoteFableCoreTests/$t" "$WORK/Tests/NoteFableCoreTests/"
  done
fi

cd "$WORK"
if [ "$#" -eq 0 ]; then set -- test; fi
swift "$@" --scratch-path /build/.build

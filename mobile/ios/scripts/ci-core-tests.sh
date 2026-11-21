#!/usr/bin/env bash
# CI（macOS）上跑 Core 的单元测试：在 mobile/ios 目录里执行。
#
# 直接 `swift test` 的话，某个测试挂住时它不会自己结束，要等整个任务的时限到了才停（macOS 机器按高倍率计分钟数），
# 而且日志里看不出卡在哪。所以这里给测试一个时限：超过了就打印测试进程各线程的调用栈，结束它并报失败。
set -euo pipefail

LIMIT_SECONDS="${CORE_TEST_LIMIT_SECONDS:-180}"

# 编译不算在时限里。
swift build --build-tests

swift test --skip-build &
test_pid=$!

(
  sleep "$LIMIT_SECONDS"
  kill -0 "$test_pid" 2>/dev/null || exit 0
  echo "::error::Core tests are still running after ${LIMIT_SECONDS}s. Sampling the test process, then stopping it."
  for pid in $(pgrep -f 'xctest' || true); do
    echo "===== sample of pid $pid: $(ps -o command= -p "$pid" | cut -c1-200) ====="
    sample "$pid" 2 2>/dev/null | head -n 500 || true
  done
  pkill -f 'xctest' || true
  kill "$test_pid" 2>/dev/null || true
) &
watchdog=$!

status=0
wait "$test_pid" || status=$?

# 先结束看门狗里的 sleep：它还拿着这一步的输出管道，留着的话这一步不会结束。
pkill -P "$watchdog" 2>/dev/null || true
kill "$watchdog" 2>/dev/null || true
exit "$status"

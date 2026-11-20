import Foundation
import XCTest
@testable import NoteFableCore

// 侧栏 / 检索 / 账号的 ViewModel 测试共用的东西。假接口都在主线程上（@MainActor），测试里读它们记下的调用不用加锁。
// Kotlin 测试靠 advanceUntilIdle 等协程跑完；这里靠"等到某件事真的发生"：ViewModel 的 idle()、门（TestGate）和假时钟（ManualClock）。

/// 一道门：假接口在 `pass()` 处等，测试 `open()` 放行（Kotlin 测试里的 CompletableDeferred<Unit>）。
/// `entered(n)` 等到第 n 个调用走到门口：之后再断言"还没发生"才有意义。
@MainActor
final class TestGate {
    private var isOpen: Bool
    private(set) var entries = 0
    private var blocked: [CheckedContinuation<Void, Never>] = []
    private var watchers: [(count: Int, continuation: CheckedContinuation<Void, Never>)] = []

    init(open: Bool = false) {
        isOpen = open
    }

    func pass() async {
        entries += 1
        let ready = watchers.filter { $0.count <= entries }
        watchers.removeAll { $0.count <= entries }
        for watcher in ready { watcher.continuation.resume() }
        if isOpen { return }
        await withCheckedContinuation { blocked.append($0) }
    }

    func open() {
        isOpen = true
        let waiting = blocked
        blocked = []
        for continuation in waiting { continuation.resume() }
    }

    func entered(_ count: Int = 1) async {
        if entries >= count { return }
        await withCheckedContinuation { watchers.append((count, $0)) }
    }
}

/// 假时钟：`sleep` 登记到点的时间，`advance` 往前拨并叫醒到点的（Kotlin 测试里的 advanceTimeBy）。
/// 拨之前先 `await registered(n)`，等第 n 次 sleep 真的登记上，时间才对得上。
@MainActor
final class ManualClock {
    private struct Sleeper {
        let id: Int
        let deadline: Int
        let continuation: CheckedContinuation<Void, Error>
    }

    private(set) var now = 0
    /// 一共登记过多少次 sleep（被取消的也算）。
    private(set) var registrations = 0
    private var sleepers: [Sleeper] = []
    private var watchers: [(count: Int, continuation: CheckedContinuation<Void, Never>)] = []

    func sleep(_ ms: Int) async throws {
        let id = registrations
        registrations += 1
        let ready = watchers.filter { $0.count <= registrations }
        watchers.removeAll { $0.count <= registrations }
        for watcher in ready { watcher.continuation.resume() }
        try Task.checkCancellation()
        let deadline = now + ms
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                if Task.isCancelled {
                    continuation.resume(throwing: CancellationError())
                } else {
                    sleepers.append(Sleeper(id: id, deadline: deadline, continuation: continuation))
                }
            }
        } onCancel: {
            Task { @MainActor in self.cancel(id) }
        }
    }

    private func cancel(_ id: Int) {
        guard let index = sleepers.firstIndex(where: { $0.id == id }) else { return }
        sleepers.remove(at: index).continuation.resume(throwing: CancellationError())
    }

    func advance(_ ms: Int) {
        now += ms
        let due = sleepers.filter { $0.deadline <= now }
        sleepers.removeAll { $0.deadline <= now }
        for sleeper in due { sleeper.continuation.resume() }
    }

    func registered(_ count: Int) async {
        if registrations >= count { return }
        await withCheckedContinuation { watchers.append((count, $0)) }
    }
}

/// 让已经排上的主线程任务先跑一轮（断言"没有发生"之前用；发生了的事用 idle() / 门来等）。
@MainActor
func settleMainActor(_ rounds: Int = 20) async {
    for _ in 0..<rounds { await Task.yield() }
}

struct TestIOError: Error, Equatable {
    var message = "offline"
}

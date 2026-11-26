import StoreKit

enum AppleSubscription {
    static func confirm(_ result: VerificationResult<Transaction>, api: AccountApi) async throws -> ApplePurchaseStatus {
        let transaction = try result.payloadValue
        try Task.checkCancellation()
        let status = try await api.confirmApplePurchase(result.jwsRepresentation)
        await transaction.finish()
        return status
    }

    static func observe(api: AccountApi, changed: @escaping @MainActor @Sendable () -> Void) async {
        await withTaskGroup(of: Void.self) { tasks in
            tasks.addTask {
                for await item in Transaction.updates {
                    if Task.isCancelled { return }
                    if (try? await confirm(item, api: api)) != nil, !Task.isCancelled { await changed() }
                }
            }
            for await item in Transaction.unfinished {
                if Task.isCancelled { break }
                if (try? await confirm(item, api: api)) != nil, !Task.isCancelled { await changed() }
            }
        }
    }
}

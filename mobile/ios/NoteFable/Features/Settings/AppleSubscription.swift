import StoreKit

enum AppleSubscription {
    static func confirm(_ result: VerificationResult<Transaction>, api: AccountApi) async throws -> ApplePurchaseStatus {
        let transaction = try result.payloadValue
        try Task.checkCancellation()
        let status = try await api.confirmApplePurchase(result.jwsRepresentation)
        await transaction.finish()
        return status
    }

    static func observe(api: AccountApi) async {
        await withTaskGroup(of: Void.self) { tasks in
            tasks.addTask {
                for await item in Transaction.updates {
                    if Task.isCancelled { return }
                    _ = try? await confirm(item, api: api)
                }
            }
            for await item in Transaction.unfinished {
                if Task.isCancelled { break }
                _ = try? await confirm(item, api: api)
            }
        }
    }
}

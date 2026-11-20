import Foundation
import XCTest
@testable import NoteFableCore

final class AccountApiTests: XCTestCase {
    private let userJson = #"{"user":{"name":"Ann","googleName":"Ann","icon":"🦊","avatarUrl":null}}"#

    private func api(_ server: FakeTransport) -> AccountApi {
        AccountApi(http: makeApi(server).http)
    }

    func testProfilePatchSendsOnlyTheEditedFieldsWithNullForReset() async throws {
        let server = FakeTransport()
        for _ in 0..<3 { server.enqueue(userJson) }
        let api = api(server)
        let user = try await api.updateProfile(.icon("🦊"))
        XCTAssertEqual(user.icon, "🦊")
        _ = try await api.updateProfile(.name("My Name"))
        _ = try await api.updateProfile(.resetToGoogle)

        let icon = server.next()
        XCTAssertEqual(icon.method, "PATCH")
        XCTAssertEqual(icon.path, "/api/account")
        XCTAssertEqual(icon.jsonKeys, ["icon"])
        XCTAssertEqual(icon.json?["icon"]?.stringValue, "🦊")
        XCTAssertEqual(server.next().jsonKeys, ["displayName"])
        let reset = server.next()
        XCTAssertEqual(reset.json?["displayName"], JSONValue.null)
        XCTAssertEqual(reset.json?["icon"], JSONValue.null)
    }

    func testLocaleNullExplicitlyRestoresAutoAndOmittedLocaleLeavesItUnchanged() async throws {
        let server = FakeTransport()
        for _ in 0..<2 { server.enqueue(userJson) }
        let api = api(server)
        _ = try await api.updateProfile(.locale(nil))
        _ = try await api.updateProfile(.name("Ann"))
        let automatic = server.next()
        XCTAssertEqual(automatic.jsonKeys, ["locale"])
        XCTAssertEqual(automatic.json?["locale"], JSONValue.null)
        XCTAssertFalse(server.next().jsonKeys.contains("locale"))

        let user = AccountUser(name: "Ann", locale: "ja")
        XCTAssertNil(applyProfileEdit(user, .locale(nil)).locale)
        XCTAssertEqual(applyProfileEdit(user, .name("Ann")).locale, "ja")
    }

    func testAvatarUploadIsOneMultipartFileFieldNamedAvatarAndServerErrorsKeepTheirSentence() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"user":{"name":"Ann","avatarUrl":"/api/account/avatar?v=x"}}"#, status: 201)
        server.enqueue(#"{"error":"That photo is too large."}"#, status: 413)
        server.enqueue("oops", status: 500)
        let api = api(server)
        let user = try await api.uploadAvatar(bytes: Data([1, 2, 3]), mimeType: "image/webp")
        XCTAssertEqual(user.avatarUrl, "/api/account/avatar?v=x")

        let request = server.next()
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.path, "/api/account/avatar")
        XCTAssertEqual(request.header("Content-Type")?.hasPrefix("multipart/form-data"), true)
        let form = MultipartParts(request)
        XCTAssertEqual(form.names, ["file"])
        XCTAssertEqual(form.parts.first?.filename, "avatar")
        XCTAssertEqual(form.parts.first?.contentType, "image/webp")
        XCTAssertEqual(form.parts.first?.data, Data([1, 2, 3]))

        let tooLarge = await errorThrown(try await api.uploadAvatar(bytes: Data([1]), mimeType: "image/webp")) as? ApiException
        XCTAssertEqual(tooLarge?.serverMessage(), "That photo is too large.")
        let broken = await errorThrown(try await api.uploadAvatar(bytes: Data([1]), mimeType: "image/webp")) as? ApiException
        XCTAssertEqual(broken?.status, 500)
        XCTAssertNil(broken?.serverMessage(), "no error JSON: no server sentence")
    }

    func testCustomInstructionsAreReadWithGETAndReplacedWithPUTAndARefusalKeepsItsSentence() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"instructions":null}"#)
        server.enqueue(#"{"instructions":"Be brief."}"#)
        server.enqueue(#"{"error":"Sign in to use custom instructions."}"#, status: 401)
        let api = api(server)
        let none = try await api.customInstructions()
        XCTAssertNil(none)
        let saved = try await api.saveCustomInstructions("Be brief.")
        XCTAssertEqual(saved, "Be brief.")

        let read = server.next()
        XCTAssertEqual(read.method, "GET")
        XCTAssertEqual(read.path, "/api/custom-instructions")
        let write = server.next()
        XCTAssertEqual(write.method, "PUT")
        XCTAssertEqual(write.path, "/api/custom-instructions")
        XCTAssertEqual(write.json, ["instructions": "Be brief."])

        let error = await errorThrown(try await api.customInstructions()) as? ApiException
        XCTAssertEqual(error?.serverMessage(), "Sign in to use custom instructions.")
    }

    func testEditsApplyLocallyLikeTheWebAndChoosingAnIconDropsTheUploadedPhoto() {
        let user = AccountUser(name: "Ann", googleName: "Ann", avatarUrl: "/api/account/avatar?v=1")
        let withIcon = applyProfileEdit(user, .icon("🦊"))
        XCTAssertEqual(withIcon.icon, "🦊")
        XCTAssertNil(withIcon.avatarUrl)

        var renamed = applyProfileEdit(user, .name("Bo"))
        XCTAssertEqual(renamed.name, "Bo")
        XCTAssertEqual(renamed.avatarUrl, "/api/account/avatar?v=1")

        renamed.icon = "🦊"
        let reset = applyProfileEdit(renamed, .resetToGoogle)
        XCTAssertEqual(reset.name, "Ann")
        XCTAssertNil(reset.icon)
        XCTAssertNil(reset.avatarUrl)

        XCTAssertFalse(profileEditChanges(AccountUser(name: "Ann", googleName: "Ann"), .icon(nil)))
        XCTAssertTrue(profileEditChanges(user, .icon(nil)))
    }

    func testThePlanIsReadFromBilling() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"plan":"pro","subscription":{"status":"active","periodEnd":"2026-12-01T00:00:00.000Z","cancelAt":null},"provider":"stripe","trialDays":0}"#)
        let plan = try await api(server).plan()
        XCTAssertEqual(server.next().path, "/api/billing")
        XCTAssertEqual(plan.plan, "pro")
        XCTAssertEqual(plan.subscription?.status, "active")
        XCTAssertEqual(plan.provider, "stripe")
    }
}

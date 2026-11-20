import Foundation
import XCTest
@testable import NoteFableCore

final class SidebarApiTests: XCTestCase {
    func testSessionPatchSendsOnlyTheGivenFieldsAndNullMovesOutOfAProject() async throws {
        let server = FakeTransport()
        server.enqueue("{}")
        server.enqueue("{}")
        let api = SessionsApi(http: makeApi(server).http)
        try await api.updateSession(id: "s 1", title: nil, pinned: true, project: nil)
        try await api.updateSession(id: "s1", title: "T", pinned: nil, project: ProjectChange(projectId: nil))
        let first = server.next()
        XCTAssertEqual(first.method, "PATCH")
        // Android 的 URLEncoder 把空格写成 +；这边写成 %20（路径里的 + 是加号本身）。
        XCTAssertEqual(first.path, "/api/sessions/s%201")
        XCTAssertEqual(first.jsonKeys, ["pinned"])
        let second = server.next()
        XCTAssertEqual(second.json?["title"]?.stringValue, "T")
        XCTAssertEqual(second.json?["projectId"], JSONValue.null)
        XCTAssertFalse(second.jsonKeys.contains("pinned"))
    }

    func testCreatesAChatInsideAProjectAndParsesReorderUpdates() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"session":{"id":"n","title":"New chat","projectId":"p"}}"#, status: 201)
        server.enqueue(#"{"items":[{"id":"a","position":0,"pinned":false,"projectId":null},{"id":"b","position":1},{"id":5}]}"#)
        let api = SessionsApi(http: makeApi(server).http)
        let created = try await api.createSession(projectId: "p")
        XCTAssertEqual(created.projectId, "p")
        XCTAssertEqual(server.next().json?["projectId"]?.stringValue, "p")
        let updates = try await api.reorderSession(id: "a", targetId: "b", after: true)
        let request = server.next()
        XCTAssertEqual(request.path, "/api/sessions/reorder")
        XCTAssertEqual(request.json?["after"]?.boolValue, true)
        XCTAssertEqual(updates.count, 2)
        XCTAssertTrue(updates[0].movedGroup)
        XCTAssertNil(updates[0].projectId)
        XCTAssertFalse(updates[1].movedGroup)
    }

    func testProjectSettingsSendOnlyChangedFieldsAndErrorsKeepTheServerSentence() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"project":{"id":"p","name":"P","noteCount":2,"hasInstructions":false}}"#)
        server.enqueue(#"{"error":"Project name is required."}"#, status: 400)
        let api = ProjectsApi(http: makeApi(server).http)
        let project = try await api.updateProjectSettings(id: "p", instructions: nil, noteIds: ["a", "b"])
        XCTAssertEqual(project.noteCount, 2)
        let sent = server.next()
        XCTAssertEqual(sent.method, "PATCH")
        XCTAssertEqual(sent.path, "/api/chat-projects/p")
        XCTAssertEqual(sent.jsonKeys, ["noteIds"])
        XCTAssertEqual(sent.json?["noteIds"]?.arrayValue?.count, 2)
        let error = await errorThrown(try await api.createProject(name: "")) as? ApiException
        XCTAssertEqual(error?.message, "Project name is required.")
    }
}

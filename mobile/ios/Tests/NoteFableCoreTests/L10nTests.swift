import XCTest
@testable import NoteFableCore

final class L10nTests: XCTestCase {
    func testFormatReplacesAndroidPlaceholders() {
        XCTAssertEqual(L10n.format("%1$d/%2$d attached", [2, 10]), "2/10 attached")
        XCTAssertEqual(L10n.format("Uploading %1$d/%2$d · %3$s · %4$d%%", [1, 3, "2 MB", 40]), "Uploading 1/3 · 2 MB · 40%")
        XCTAssertEqual(L10n.format("“%2$s” then %1$s", ["a", "b"]), "“b” then a")
        XCTAssertEqual(L10n.format("100% of %1$s", ["x"]), "100% of x")
        XCTAssertEqual(L10n.format("%3$s stays", ["a"]), "%3$s stays")
    }

    func testMissingKeyFallsBackToKey() {
        XCTAssertEqual(L("no_such_key"), "no_such_key")
    }

    func testJSONValueRoundTrip() {
        let value = JSONValue.parse(#"{"a":[1,2.5,"x",null,true],"b":{"c":"d"}}"#)
        XCTAssertEqual(value?["a"]?[0]?.intValue, 1)
        XCTAssertEqual(value?["a"]?[1]?.doubleValue, 2.5)
        XCTAssertNil(value?["a"]?[1]?.intValue)
        XCTAssertEqual(value?["b"]?["c"]?.stringValue, "d")
        XCTAssertEqual(value?.encodedString(), #"{"a":[1,2.5,"x",null,true],"b":{"c":"d"}}"#)
    }
}

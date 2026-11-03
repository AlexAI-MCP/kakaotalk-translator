import CSQLCipher
import Foundation
import Testing
@testable import KakaoCore

// Synthetic fixtures only; the reader under test opens the fixture read-only.
private final class ChatFixture {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let path: String
    var db: OpaquePointer?

    init() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        path = directory.appendingPathComponent("fixture.db").path
        #expect(sqlite3_open(path, &db) == SQLITE_OK)
        try exec("""
            CREATE TABLE NTChatRoom (
                chatId INTEGER, type INTEGER, chatName TEXT, activeMembersCount INTEGER,
                lastLogId INTEGER, lastUpdatedAt INTEGER, countOfNewMessage INTEGER,
                directChatMemberUserId INTEGER, linkId INTEGER, displayMemberIds BLOB
            );
            CREATE TABLE NTUser (userId INTEGER, linkId INTEGER, displayName TEXT, friendNickName TEXT, nickName TEXT);
            CREATE TABLE NTOpenLink (linkId INTEGER PRIMARY KEY, linkName TEXT);
            """)
    }

    deinit {
        sqlite3_close(db)
        try? FileManager.default.removeItem(at: directory)
    }

    func exec(_ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else {
            throw NSError(domain: "ChatFixture", code: 1)
        }
    }

    func room(_ id: Int, title: String = "NULL", link: Int = 0, direct: Int = 0,
              members: [Int64] = [], invalidBlob: Bool = false) throws {
        let data = try PropertyListSerialization.data(fromPropertyList: members, format: .binary, options: 0)
        let hex = invalidBlob ? "00FF" : data.map { String(format: "%02x", $0) }.joined()
        try exec("INSERT INTO NTChatRoom VALUES (\(id),1,\(title),4,NULL,\(id),0,\(direct),\(link),X'\(hex)')")
    }

    func chats(limit: Int = 50) throws -> [Chat] {
        let reader = DatabaseReader(databasePath: path)
        try reader.open()
        defer { reader.close() }
        return try reader.chats(limit: limit)
    }
}

@Suite struct ChatNamesTests {
    @Test func storedTitlesAndContactsKeepPriority() throws {
        let fixture = try ChatFixture()
        try fixture.exec("""
            INSERT INTO NTUser VALUES (10,0,'Contact',NULL,NULL);
            INSERT INTO NTOpenLink VALUES (20,'Open title');
            """)
        try fixture.room(1, title: "'Custom title'", link: 20, direct: 10, members: [10])
        try fixture.room(2, link: 20, direct: 10)
        try fixture.room(3, direct: 10)
        #expect(try fixture.chats().map(\.displayName) == ["Contact", "Open title", "Custom title"])
    }

    @Test func unnamedGroupsUseOrderedParticipantNames() throws {
        let fixture = try ChatFixture()
        try fixture.exec("""
            INSERT INTO NTUser VALUES (10,0,'Alice',NULL,NULL);
            INSERT INTO NTUser VALUES (11,0,'  ','Bob',NULL);
            INSERT INTO NTUser VALUES (12,0,NULL,'','Carol');
            INSERT INTO NTUser VALUES (13,0,'Dana',NULL,NULL);
            """)
        try fixture.room(1, members: [11, 99, 10, 12, 13])
        #expect(try fixture.chats().first?.displayName == "Bob, Alice, Carol, …")
    }

    @Test func openChatParticipantsUseRoomScopedNames() throws {
        let fixture = try ChatFixture()
        try fixture.exec("""
            INSERT INTO NTUser VALUES (10,0,'Contact name',NULL,NULL);
            INSERT INTO NTUser VALUES (10,20,'Room nickname',NULL,NULL);
            INSERT INTO NTUser VALUES (10,30,'Other room',NULL,NULL);
            """)
        try fixture.room(1, link: 20, members: [10])
        try fixture.room(2, link: 40, members: [10])
        #expect(try fixture.chats().map(\.displayName) == ["Unnamed chat", "Room nickname"])
    }

    @Test func blankNamesMissingMembersAndMalformedBlobsStayReadable() throws {
        let fixture = try ChatFixture()
        try fixture.exec("""
            INSERT INTO NTOpenLink VALUES (20,'  ');
            INSERT INTO NTUser VALUES (10,0,'','  ','Fallback');
            """)
        try fixture.room(1, title: "'  '", link: 20, direct: 10)
        try fixture.room(2, members: [99])
        try fixture.room(3, invalidBlob: true)
        try fixture.room(4)
        #expect(try fixture.chats().map(\.displayName) == ["Unnamed chat", "Unnamed chat", "Unnamed chat", "Fallback"])
        #expect(try fixture.chats(limit: 2).map(\.id) == [4, 3])
    }
}

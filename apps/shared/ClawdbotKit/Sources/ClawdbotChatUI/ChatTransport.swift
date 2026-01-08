import Foundation

public enum ZeeChatTransportEvent: Sendable {
    case health(ok: Bool)
    case tick
    case chat(ZeeChatEventPayload)
    case agent(ZeeAgentEventPayload)
    case seqGap
}

public protocol ZeeChatTransport: Sendable {
    func requestHistory(sessionKey: String) async throws -> ZeeChatHistoryPayload
    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [ZeeChatAttachmentPayload]) async throws -> ZeeChatSendResponse

    func abortRun(sessionKey: String, runId: String) async throws
    func listSessions(limit: Int?) async throws -> ZeeChatSessionsListResponse

    func requestHealth(timeoutMs: Int) async throws -> Bool
    func events() -> AsyncStream<ZeeChatTransportEvent>

    func setActiveSessionKey(_ sessionKey: String) async throws
}

extension ZeeChatTransport {
    public func setActiveSessionKey(_: String) async throws {}

    public func abortRun(sessionKey _: String, runId _: String) async throws {
        throw NSError(
            domain: "ZeeChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "chat.abort not supported by this transport"])
    }

    public func listSessions(limit _: Int?) async throws -> ZeeChatSessionsListResponse {
        throw NSError(
            domain: "ZeeChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.list not supported by this transport"])
    }
}

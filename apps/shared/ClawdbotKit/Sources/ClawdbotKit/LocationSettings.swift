import Foundation

public enum ZeeLocationMode: String, Codable, Sendable, CaseIterable {
    case off
    case whileUsing
    case always
}

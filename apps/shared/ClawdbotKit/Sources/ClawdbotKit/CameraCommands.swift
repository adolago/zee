import Foundation

public enum ZeeCameraCommand: String, Codable, Sendable {
    case list = "camera.list"
    case snap = "camera.snap"
    case clip = "camera.clip"
}

public enum ZeeCameraFacing: String, Codable, Sendable {
    case back
    case front
}

public enum ZeeCameraImageFormat: String, Codable, Sendable {
    case jpg
    case jpeg
}

public enum ZeeCameraVideoFormat: String, Codable, Sendable {
    case mp4
}

public struct ZeeCameraSnapParams: Codable, Sendable, Equatable {
    public var facing: ZeeCameraFacing?
    public var maxWidth: Int?
    public var quality: Double?
    public var format: ZeeCameraImageFormat?
    public var deviceId: String?
    public var delayMs: Int?

    public init(
        facing: ZeeCameraFacing? = nil,
        maxWidth: Int? = nil,
        quality: Double? = nil,
        format: ZeeCameraImageFormat? = nil,
        deviceId: String? = nil,
        delayMs: Int? = nil)
    {
        self.facing = facing
        self.maxWidth = maxWidth
        self.quality = quality
        self.format = format
        self.deviceId = deviceId
        self.delayMs = delayMs
    }
}

public struct ZeeCameraClipParams: Codable, Sendable, Equatable {
    public var facing: ZeeCameraFacing?
    public var durationMs: Int?
    public var includeAudio: Bool?
    public var format: ZeeCameraVideoFormat?
    public var deviceId: String?

    public init(
        facing: ZeeCameraFacing? = nil,
        durationMs: Int? = nil,
        includeAudio: Bool? = nil,
        format: ZeeCameraVideoFormat? = nil,
        deviceId: String? = nil)
    {
        self.facing = facing
        self.durationMs = durationMs
        self.includeAudio = includeAudio
        self.format = format
        self.deviceId = deviceId
    }
}

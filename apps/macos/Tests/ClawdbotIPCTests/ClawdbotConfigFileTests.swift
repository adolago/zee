import Foundation
import Testing
@testable import Zee

@Suite(.serialized)
struct ZeeConfigFileTests {
    @Test
    func configPathRespectsEnvOverride() async {
        let override = FileManager.default.temporaryDirectory
            .appendingPathComponent("zee-config-\(UUID().uuidString)")
            .appendingPathComponent("zee.json")
            .path

        await TestIsolation.withEnvValues(["ZEE_CONFIG_PATH": override]) {
            #expect(ZeeConfigFile.url().path == override)
        }
    }

    @MainActor
    @Test
    func remoteGatewayPortParsesAndMatchesHost() async {
        let override = FileManager.default.temporaryDirectory
            .appendingPathComponent("zee-config-\(UUID().uuidString)")
            .appendingPathComponent("zee.json")
            .path

        await TestIsolation.withEnvValues(["ZEE_CONFIG_PATH": override]) {
            ZeeConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "ws://bridge.ts.net:19999",
                    ],
                ],
            ])
            #expect(ZeeConfigFile.remoteGatewayPort() == 19999)
            #expect(ZeeConfigFile.remoteGatewayPort(matchingHost: "bridge.ts.net") == 19999)
            #expect(ZeeConfigFile.remoteGatewayPort(matchingHost: "bridge") == 19999)
            #expect(ZeeConfigFile.remoteGatewayPort(matchingHost: "other.ts.net") == nil)
        }
    }

    @MainActor
    @Test
    func setRemoteGatewayUrlPreservesScheme() async {
        let override = FileManager.default.temporaryDirectory
            .appendingPathComponent("zee-config-\(UUID().uuidString)")
            .appendingPathComponent("zee.json")
            .path

        await TestIsolation.withEnvValues(["ZEE_CONFIG_PATH": override]) {
            ZeeConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "wss://old-host:111",
                    ],
                ],
            ])
            ZeeConfigFile.setRemoteGatewayUrl(host: "new-host", port: 2222)
            let root = ZeeConfigFile.loadDict()
            let url = ((root["gateway"] as? [String: Any])?["remote"] as? [String: Any])?["url"] as? String
            #expect(url == "wss://new-host:2222")
        }
    }

    @Test
    func stateDirOverrideSetsConfigPath() async {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("zee-state-\(UUID().uuidString)", isDirectory: true)
            .path

        await TestIsolation.withEnvValues([
            "ZEE_CONFIG_PATH": nil,
            "ZEE_STATE_DIR": dir,
        ]) {
            #expect(ZeeConfigFile.stateDirURL().path == dir)
            #expect(ZeeConfigFile.url().path == "\(dir)/zee.json")
        }
    }
}

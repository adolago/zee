import ZeeKit
import Network
import Testing
@testable import Zee

@Suite struct BridgeEndpointIDTests {
    @Test func stableIDForServiceDecodesAndNormalizesName() {
        let endpoint = NWEndpoint.service(
            name: "Zee\\032Bridge   \\032  Node\n",
            type: "_zee-bridge._tcp",
            domain: "local.",
            interface: nil)

        #expect(BridgeEndpointID.stableID(endpoint) == "_zee-bridge._tcp|local.|Zee Bridge Node")
    }

    @Test func stableIDForNonServiceUsesEndpointDescription() {
        let endpoint = NWEndpoint.hostPort(host: NWEndpoint.Host("127.0.0.1"), port: 4242)
        #expect(BridgeEndpointID.stableID(endpoint) == String(describing: endpoint))
    }

    @Test func prettyDescriptionDecodesBonjourEscapes() {
        let endpoint = NWEndpoint.service(
            name: "Zee\\032Bridge",
            type: "_zee-bridge._tcp",
            domain: "local.",
            interface: nil)

        let pretty = BridgeEndpointID.prettyDescription(endpoint)
        #expect(pretty == BonjourEscapes.decode(String(describing: endpoint)))
        #expect(!pretty.localizedCaseInsensitiveContains("\\032"))
    }
}

import Testing
@testable import Zee

@Suite(.serialized)
struct BridgeServerTests {
    @Test func bridgeServerExercisesPaths() async {
        let server = BridgeServer()
        await server.exerciseForTesting()
    }
}

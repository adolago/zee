import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { listPods, removePod, setActivePod, setupPod } from "../../src/pods/manager"

describe("pods manager", () => {
  test("setup, set-active, and remove lifecycle works", async () => {
    await using tmp = await tmpdir()
    const prev = process.env.ZEE_TEST_HOME
    process.env.ZEE_TEST_HOME = tmp.path
    try {
      await setupPod({ name: "dc1", ssh: "ssh root@1.2.3.4" })
      let listed = await listPods()
      expect(listed.activePod).toBe("dc1")
      expect(listed.pods.length).toBe(1)

      await setupPod({ name: "a", ssh: "ssh root@a" })
      await setupPod({ name: "b", ssh: "ssh root@b", setActive: false })

      await setActivePod("b")
      listed = await listPods()
      expect(listed.activePod).toBe("b")

      const removed = await removePod("b")
      expect(removed?.name).toBe("b")

      listed = await listPods()
      expect(listed.activePod).toBe("dc1")
      expect(listed.pods.map((p) => p.name)).toEqual(["a", "dc1"])
    } finally {
      process.env.ZEE_TEST_HOME = prev
    }
  })
})

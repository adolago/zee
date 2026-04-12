import { afterEach, expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { kvPath, loadKV, resolveStateDir, saveKV } from "../../../../.zee/tool/lib/zee-banner"

const originalStateDir = process.env.ZEE_STATE_DIR

afterEach(() => {
  if (originalStateDir === undefined) delete process.env.ZEE_STATE_DIR
  else process.env.ZEE_STATE_DIR = originalStateDir
})

test("uses ZEE_STATE_DIR for banner KV storage", async () => {
  await using tmp = await tmpdir()
  process.env.ZEE_STATE_DIR = tmp.path

  expect(resolveStateDir()).toBe(path.resolve(tmp.path))
  expect(kvPath()).toBe(path.join(path.resolve(tmp.path), "kv.json"))

  await saveKV({ zee_banner: { version: 1, items: [] } })
  expect(await loadKV()).toEqual({ zee_banner: { version: 1, items: [] } })
})

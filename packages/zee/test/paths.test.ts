import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "./fixture/fixture"
import { Stanley } from "../src/paths"

const ORIGINAL_STANLEY_CORE_BIN = process.env.STANLEY_CORE_BIN
const ORIGINAL_STANLEY_API_URL = process.env.STANLEY_API_URL

async function writeExecutable(filePath: string, body: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, body, "utf8")
  await fs.chmod(filePath, 0o755)
}

beforeEach(() => {
  delete process.env.STANLEY_CORE_BIN
  delete process.env.STANLEY_API_URL
})

afterEach(() => {
  if (ORIGINAL_STANLEY_CORE_BIN === undefined) delete process.env.STANLEY_CORE_BIN
  else process.env.STANLEY_CORE_BIN = ORIGINAL_STANLEY_CORE_BIN

  if (ORIGINAL_STANLEY_API_URL === undefined) delete process.env.STANLEY_API_URL
  else process.env.STANLEY_API_URL = ORIGINAL_STANLEY_API_URL
})

describe("Stanley.preflight", () => {
  test("accepts explicit STANLEY_CORE_BIN without Python setup", async () => {
    await using tmp = await tmpdir()
    const coreBin = path.join(tmp.path, "bin", "stanley")
    await writeExecutable(
      coreBin,
      "#!/usr/bin/env sh\n" +
        "if [ \"$1\" = \"--version\" ]; then\n" +
        "  exit 0\n" +
        "fi\n" +
        "exit 0\n",
    )
    process.env.STANLEY_CORE_BIN = coreBin

    const err = Stanley.preflight()
    expect(err).toBeNull()
  })

  test("requires STANLEY_CORE_BIN when unset", () => {
    const err = Stanley.preflight()
    expect(err).toBeDefined()
    expect(err).toContain("STANLEY_CORE_BIN")
    expect(err).toContain("not configured")
  })

  test("accepts explicit STANLEY_API_URL without local binary setup", () => {
    process.env.STANLEY_API_URL = "http://127.0.0.1:8000"

    const err = Stanley.preflight()
    expect(err).toBeNull()
  })

  test("fails with a clear error when STANLEY_CORE_BIN is invalid", async () => {
    await using tmp = await tmpdir()
    process.env.STANLEY_CORE_BIN = path.join(tmp.path, "missing-stanley")

    const err = Stanley.preflight()
    expect(err).toBeDefined()
    expect(err).toContain("not executable")
    expect(err).toContain("STANLEY_CORE_BIN")
  })

  test("fails with a clear error when the configured core binary probe fails", async () => {
    await using tmp = await tmpdir()
    const coreBin = path.join(tmp.path, "bin", "stanley-fail")
    await writeExecutable(
      coreBin,
      "#!/usr/bin/env sh\n" +
        "exit 7\n",
    )
    process.env.STANLEY_CORE_BIN = coreBin

    const err = Stanley.preflight()
    expect(err).toBeDefined()
    expect(err).toContain("startup probe")
    expect(err).toContain(coreBin)
  })
})

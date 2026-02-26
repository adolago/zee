import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "./fixture/fixture"
import { Stanley } from "../src/paths"

const ORIGINAL_STANLEY_REPO = process.env.STANLEY_REPO
const ORIGINAL_STANLEY_PYTHON = process.env.STANLEY_PYTHON

async function createStanleyRepo(root: string): Promise<string> {
  const repo = path.join(root, "stanley-repo")
  await fs.mkdir(path.join(repo, "stanley"), { recursive: true })
  return repo
}

async function writeExecutable(filePath: string, body: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, body, "utf8")
  await fs.chmod(filePath, 0o755)
}

beforeEach(() => {
  delete process.env.STANLEY_REPO
  delete process.env.STANLEY_PYTHON
})

afterEach(() => {
  if (ORIGINAL_STANLEY_REPO === undefined) delete process.env.STANLEY_REPO
  else process.env.STANLEY_REPO = ORIGINAL_STANLEY_REPO

  if (ORIGINAL_STANLEY_PYTHON === undefined) delete process.env.STANLEY_PYTHON
  else process.env.STANLEY_PYTHON = ORIGINAL_STANLEY_PYTHON
})

describe("Stanley.preflight", () => {
  test("requires STANLEY_PYTHON when stanley/.venv is missing", async () => {
    await using tmp = await tmpdir()
    const repo = await createStanleyRepo(tmp.path)
    process.env.STANLEY_REPO = repo

    const err = Stanley.preflight()
    expect(err).toBeDefined()
    expect(err).toContain("venv not found")
    expect(err).toContain("STANLEY_PYTHON")
  })

  test("accepts explicit STANLEY_PYTHON when venv is missing", async () => {
    await using tmp = await tmpdir()
    const repo = await createStanleyRepo(tmp.path)
    process.env.STANLEY_REPO = repo

    const python = path.join(tmp.path, "bin", "python-ok")
    await writeExecutable(
      python,
      "#!/usr/bin/env sh\n" +
        "# Simulate a healthy interpreter for preflight checks\n" +
        "exit 0\n",
    )
    process.env.STANLEY_PYTHON = python

    const err = Stanley.preflight()
    expect(err).toBeNull()
  })

  test("fails with a clear error when STANLEY_PYTHON is invalid", async () => {
    await using tmp = await tmpdir()
    const repo = await createStanleyRepo(tmp.path)
    process.env.STANLEY_REPO = repo
    process.env.STANLEY_PYTHON = path.join(tmp.path, "missing-python")

    const err = Stanley.preflight()
    expect(err).toBeDefined()
    expect(err).toContain("not executable")
    expect(err).toContain("STANLEY_PYTHON")
  })

  test("uses stanley/.venv/bin/python when available", async () => {
    await using tmp = await tmpdir()
    const repo = await createStanleyRepo(tmp.path)
    process.env.STANLEY_REPO = repo

    const venvPython = path.join(repo, ".venv", "bin", "python")
    await writeExecutable(
      venvPython,
      "#!/usr/bin/env sh\n" +
        "# Simulate a valid venv interpreter for import checks\n" +
        "exit 0\n",
    )

    const err = Stanley.preflight()
    expect(err).toBeNull()
  })
})

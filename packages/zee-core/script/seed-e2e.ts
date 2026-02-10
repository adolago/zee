const dir = process.env.ZEE_E2E_PROJECT_DIR ?? process.env.AGENT_CORE_E2E_PROJECT_DIR ?? process.cwd()
const title = process.env.ZEE_E2E_SESSION_TITLE ?? process.env.AGENT_CORE_E2E_SESSION_TITLE ?? "E2E Session"
const text = process.env.ZEE_E2E_MESSAGE ?? process.env.AGENT_CORE_E2E_MESSAGE ?? "Seeded for UI e2e"
const model = process.env.ZEE_E2E_MODEL ?? process.env.AGENT_CORE_E2E_MODEL ?? "zai-coding-plan/glm-4.7"
const parts = model.split("/")
const providerID = parts[0] ?? "zai-coding-plan"
const modelID = parts[1] ?? "glm-4.7"
const now = Date.now()

const seed = async () => {
  const { Instance } = await import("../src/project/instance")
  const { InstanceBootstrap } = await import("../src/project/bootstrap")
  const { Session } = await import("../src/session")
  const { Identifier } = await import("../src/id/id")
  const { Project } = await import("../src/project/project")

  try {
    await Instance.provide({
      directory: dir,
      init: InstanceBootstrap,
      fn: async () => {
        const session = await Session.create({ title })
        const messageID = Identifier.descending("message")
        const partID = Identifier.descending("part")
        const message = {
          id: messageID,
          sessionID: session.id,
          role: "user" as const,
          time: { created: now },
          agent: "zee",
          model: {
            providerID,
            modelID,
          },
        }
        const part = {
          id: partID,
          sessionID: session.id,
          messageID,
          type: "text" as const,
          text,
          time: { start: now },
        }
        await Session.updateMessage(message)
        await Session.updatePart(part)
        await Project.update({ projectID: Instance.project.id, name: "E2E Project" })
      },
    })
  } finally {
    // Prevent long-lived services (watchers, timers) from keeping the seed process alive.
    await Instance.disposeAll().catch(() => undefined)
  }
}

await seed()
// Seed scripts should be short-lived; force exit in case any library leaves handles open.
process.exit(0)

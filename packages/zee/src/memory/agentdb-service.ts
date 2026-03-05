import { Log } from "@/util/log"

const log = Log.create({ service: "memory:agentdb" })

type AgentDbMemory = {
  init: () => Promise<void>
  stats: () => Promise<unknown>
  [key: string]: unknown
}

let memoryInstance: AgentDbMemory | null = null
let initPromise: Promise<AgentDbMemory> | null = null

async function createAgentDbMemory(): Promise<AgentDbMemory> {
  const { getMemory } = await import("../../../../src/memory/unified")
  const memory = getMemory() as AgentDbMemory
  await memory.init()
  return memory
}

export async function getAgentDbMemory(): Promise<AgentDbMemory> {
  if (memoryInstance) return memoryInstance
  if (!initPromise) {
    initPromise = createAgentDbMemory().then((memory) => {
      memoryInstance = memory
      return memory
    })
  }
  return initPromise
}

export async function getAgentDbMemoryStats(): Promise<unknown> {
  try {
    const memory = await getAgentDbMemory()
    if (typeof memory.stats !== "function") return {}
    return await memory.stats()
  } catch (error) {
    log.warn("AgentDB stats unavailable", {
      error: error instanceof Error ? error.message : String(error),
    })
    return {}
  }
}

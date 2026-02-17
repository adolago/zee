import { z } from "zod"
import { Auth } from "@/auth"

export namespace Grammar {
  export const Match = z.object({
    message: z.string(),
    shortMessage: z.string().optional(),
    offset: z.number(),
    length: z.number(),
    replacements: z.array(z.object({ value: z.string() })),
    context: z.object({
      text: z.string(),
      offset: z.number(),
      length: z.number(),
    }),
    rule: z.object({
      id: z.string(),
      description: z.string(),
      issueType: z.string(),
    }),
  })

  export type Match = z.infer<typeof Match>

  async function resolveAuth(): Promise<{ username?: string; apiKey?: string }> {
    const stored = await Auth.get("languagetool").catch(() => undefined)
    if (stored?.type === "api" && stored.key) {
      return {
        username: (stored as { username?: string }).username,
        apiKey: stored.key,
      }
    }
    return {}
  }

  export async function check(text: string): Promise<Match[]> {
    try {
      const auth = await resolveAuth()
      const params = new URLSearchParams()
      params.append("text", text)
      params.append("language", "auto")

      if (auth.username && auth.apiKey) {
        params.append("username", auth.username)
        params.append("apiKey", auth.apiKey)
      }

      const response = await fetch("https://api.languagetool.org/v2/check", {
        method: "POST",
        body: params,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
      })

      if (!response.ok) {
        throw new Error(`Grammar check failed: ${response.statusText}`)
      }

      const json = await response.json()
      const result = z.object({ matches: z.array(Match) }).safeParse(json)

      if (!result.success) {
        console.error("Grammar API response parse error", result.error)
        return []
      }

      return result.data.matches
    } catch (e) {
      console.error("Grammar check error", e)
      return []
    }
  }
}

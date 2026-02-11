import { Instance } from "@/project/instance"
import { Plugin } from "../plugin"
import { map, filter, pipe, fromEntries, mapValues } from "remeda"
import z from "zod"
import { fn } from "@/util/fn"
import type { AuthOuathResult } from "@zee/plugin"
import { NamedError } from "@zee/util/error"
import { Auth } from "@/auth"
import { Provider } from "@/provider/provider"
import { randomUUID } from "crypto"

type PendingAuth = {
  result: AuthOuathResult
  method: number
  createdAt: number
}

export namespace ProviderAuth {
  const state = Instance.state(async () => {
    const methods = pipe(
      await Plugin.list(),
      filter((x) => x.auth?.provider !== undefined),
      map((x) => [x.auth!.provider, x.auth!] as const),
      fromEntries(),
    )
    return { methods, pending: {} as Record<string, Record<string, PendingAuth>> }
  })

  export const Method = z
    .object({
      type: z.union([z.literal("oauth"), z.literal("api")]),
      label: z.string(),
    })
    .meta({
      ref: "ProviderAuthMethod",
    })
  export type Method = z.infer<typeof Method>

  export async function methods() {
    const s = await state().then((x) => x.methods)
    return mapValues(s, (x) =>
      x.methods.map(
        (y): Method => ({
          type: y.type,
          label: y.label,
        }),
      ),
    )
  }

  export const Authorization = z
    .object({
      url: z.string(),
      method: z.union([z.literal("auto"), z.literal("code")]),
      instructions: z.string(),
      requestId: z.string().optional(),
    })
    .meta({
      ref: "ProviderAuthAuthorization",
    })
  export type Authorization = z.infer<typeof Authorization>

  export const authorize = fn(
    z.object({
      providerID: z.string(),
      method: z.number(),
    }),
    async (input): Promise<Authorization | undefined> => {
      const auth = await state().then((s) => s.methods[input.providerID])
      const method = auth.methods[input.method]
      if (method.type === "oauth") {
        const result = await method.authorize()
        const requestId = randomUUID()
        await state().then((s) => {
          s.pending[input.providerID] ??= {}
          s.pending[input.providerID][requestId] = {
            result,
            method: input.method,
            createdAt: Date.now(),
          }
        })
        return {
          url: result.url,
          method: result.method,
          instructions: result.instructions,
          requestId,
        }
      }
    },
  )

  export const callback = fn(
    z.object({
      providerID: z.string(),
      method: z.number(),
      code: z.string().optional(),
      requestId: z.string().optional(),
    }),
    async (input) => {
      const pending = await state().then((s) => s.pending[input.providerID])
      let requestId = input.requestId
      if (!requestId && pending && Object.keys(pending).length === 1) {
        requestId = Object.keys(pending)[0]
      }
      if (!pending || !requestId || !pending[requestId]) {
        throw new OauthStateMismatch({ providerID: input.providerID })
      }
      const entry = pending[requestId]
      if (entry.method !== input.method) {
        throw new OauthStateMismatch({ providerID: input.providerID })
      }

      try {
        const match = entry.result
        let result

        if (match.method === "code") {
          if (!input.code) throw new OauthCodeMissing({ providerID: input.providerID })
          result = await match.callback(input.code)
        }

        if (match.method === "auto") {
          result = await match.callback()
        }

        if (result?.type === "success") {
          if ("key" in result) {
            await Auth.set(input.providerID, {
              type: "api",
              key: result.key,
            })
            await Provider.reload()
          }
          if ("refresh" in result) {
            const info: Auth.Info = {
              type: "oauth",
              access: result.access,
              refresh: result.refresh,
              expires: result.expires,
            }
            if (result.accountId) {
              info.accountId = result.accountId
            }
            await Auth.set(input.providerID, info)
            await Provider.reload()
          }
          return
        }

        throw new OauthCallbackFailed({})
      } finally {
        await state().then((s) => {
          const providerPending = s.pending[input.providerID]
          if (!providerPending || !requestId) return
          delete providerPending[requestId]
          if (Object.keys(providerPending).length === 0) {
            delete s.pending[input.providerID]
          }
        })
      }
    },
  )

  export const api = fn(
    z.object({
      providerID: z.string(),
      key: z.string(),
    }),
    async (input) => {
      await Auth.set(input.providerID, {
        type: "api",
        key: input.key,
      })
      await Provider.reload()
      try {
        await Provider.validateAuth(input.providerID)
      } catch (error) {
        await Auth.remove(input.providerID)
        await Provider.reload()
        throw error
      }
    },
  )

  export const OauthMissing = NamedError.create(
    "ProviderAuthOauthMissing",
    z.object({
      providerID: z.string(),
    }),
  )
  export const OauthCodeMissing = NamedError.create(
    "ProviderAuthOauthCodeMissing",
    z.object({
      providerID: z.string(),
    }),
  )

  export const OauthCallbackFailed = NamedError.create("ProviderAuthOauthCallbackFailed", z.object({}))
  export const OauthStateMismatch = NamedError.create(
    "ProviderAuthOauthStateMismatch",
    z.object({
      providerID: z.string(),
    }),
  )
}

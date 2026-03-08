import { describeRoute, resolver, validator } from "hono-openapi"
import { Hono } from "hono"
import { z } from "zod"
import { Auth } from "../../auth"
import { Provider } from "../../provider/provider"
import { errors } from "../error"
import { FluxRecorder } from "@/flux"
import { RequestMeta } from "../request-meta"

export const AuthRoute = new Hono()
  .put(
    "/:providerID",
    describeRoute({
      summary: "Set auth credentials",
      description: "Set authentication credentials",
      operationId: "auth.set",
      responses: {
        200: {
          description: "Successfully set authentication credentials",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "param",
      z.object({
        providerID: z.string(),
      }),
    ),
    validator(
      "json",
      z
        .union([
          // Modern client payload
          Auth.Info,
          // Backwards-compatible payload
          z.object({ api_key: z.string() }),
        ])
        .optional(),
    ),
    async (c) => {
      const providerID = c.req.valid("param").providerID
      const body = c.req.valid("json")
      const traceID = RequestMeta.getTraceID(c.req.raw) ?? crypto.randomUUID()
      const requestID = RequestMeta.getRequestID(c.req.raw)

      if (body) {
        const usedLegacyPayload = !("type" in body) && "api_key" in body
        const auth =
          "type" in body
            ? body
            : "api_key" in body
              ? ({
                  type: "api",
                  key: body.api_key,
                } satisfies Auth.Info)
              : undefined

        if (auth) {
          await Auth.set(providerID, auth)
          FluxRecorder.record({
            traceID,
            requestID,
            providerID,
            direction: "internal",
            domain: "auth",
            kind: "secret.resolved",
            status: "ok",
            route: "/auth/:providerID",
            method: "PUT",
            metadata: {
              source: "api:auth.set",
              authType: auth.type,
            },
          })
          if (usedLegacyPayload) {
            FluxRecorder.record({
              traceID,
              requestID,
              providerID,
              direction: "internal",
              domain: "auth",
              kind: "auth.legacy_payload.accepted",
              status: "ok",
              route: "/auth/:providerID",
              method: "PUT",
              metadata: {
                payloadShape: "api_key",
              },
            })
          }
        }
      }
      await Provider.reload()
      try {
        await Provider.validateAuth(providerID)
      } catch (error) {
        await Auth.remove(providerID)
        await Provider.reload()
        const message = error instanceof Error ? error.message : String(error)
        FluxRecorder.record({
          traceID,
          requestID,
          providerID,
          direction: "internal",
          domain: "auth",
          kind: "event",
          status: "error",
          route: "/auth/:providerID",
          method: "PUT",
          error: {
            code: "auth_validation_failed",
            message,
          },
        })
        return c.json({ data: null, errors: [{ message, daemonPid: process.pid }], success: false }, 400)
      }
      return c.json(true)
    },
  )
  .delete(
    "/:providerID",
    describeRoute({
      summary: "Remove auth credentials",
      description: "Remove authentication credentials",
      operationId: "auth.remove",
      responses: {
        200: {
          description: "Successfully removed authentication credentials",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        providerID: z.string(),
      }),
    ),
    async (c) => {
      const providerID = c.req.valid("param").providerID
      const traceID = RequestMeta.getTraceID(c.req.raw) ?? crypto.randomUUID()
      const requestID = RequestMeta.getRequestID(c.req.raw)
      await Auth.remove(providerID)
      await Provider.reload()
      FluxRecorder.record({
        traceID,
        requestID,
        providerID,
        direction: "internal",
        domain: "auth",
        kind: "event",
        status: "ok",
        route: "/auth/:providerID",
        method: "DELETE",
        metadata: {
          action: "auth.remove",
        },
      })
      return c.json(true)
    },
  )

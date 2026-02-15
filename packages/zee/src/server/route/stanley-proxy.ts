import { Hono } from "hono"
import { Stanley } from "../../paths"

const app = new Hono()

app.all("/*", async (c) => {
  const baseUrl = Stanley.apiUrl()
  const path = c.req.path
  const target = `${baseUrl}${path}`

  const headers = new Headers(c.req.raw.headers)
  // Remove hop-by-hop headers
  headers.delete("host")

  const resp = await fetch(target, {
    method: c.req.method,
    headers,
    body: c.req.method !== "GET" && c.req.method !== "HEAD" ? c.req.raw.body : undefined,
  })

  return new Response(resp.body, {
    status: resp.status,
    headers: resp.headers,
  })
})

export { app as StanleyProxyRoute }

import { Hono } from "hono"
import { Investing } from "../../paths"

const app = new Hono()

app.all("/*", async (c) => {
  const baseUrl = Investing.apiUrl()
  const path = c.req.path
  const search = new URL(c.req.url).search
  const target = `${baseUrl}${path}${search}`

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

export { app as InvestingProxyRoute }

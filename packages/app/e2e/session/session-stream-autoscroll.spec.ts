import { test, expect } from "../fixtures"
import { withSession } from "../actions"
import { sessionResumeDockSelector, sessionResumeScrollSelector, sessionScrollerSelector } from "../selectors"

test("manual scroll up stays pinned while content keeps growing", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, `e2e scroll lock ${Date.now()}`, async (session) => {
    await sdk.session.promptAsync({
      sessionID: session.id,
      noReply: true,
      parts: [{ type: "text", text: "seed scroll test" }],
    })

    await expect
      .poll(async () => {
        const messages = await sdk.session.messages({ sessionID: session.id, limit: 1 }).then((r) => r.data ?? [])
        return messages.length
      })
      .toBeGreaterThan(0)

    await gotoSession(session.id)

    const scroller = page.locator(sessionScrollerSelector)
    const resumeDock = page.locator(sessionResumeDockSelector)
    const resumeButton = page.locator(sessionResumeScrollSelector)

    await expect(scroller).toBeVisible()

    await page.evaluate(({ scrollerSelector }) => {
      const root = document.querySelector(scrollerSelector)
      if (!(root instanceof HTMLElement)) throw new Error("Session scroller not found")

      const content = root.querySelector('[role="log"]')
      if (!(content instanceof HTMLElement)) throw new Error("Session content container not found")

      const seed = document.createElement("div")
      seed.setAttribute("data-e2e-seed", "session-scroll")
      seed.style.height = "3000px"
      content.appendChild(seed)

      root.scrollTop = root.scrollHeight
    }, { scrollerSelector: sessionScrollerSelector })

    await page.waitForTimeout(50)

    await page.evaluate(({ scrollerSelector }) => {
      const root = document.querySelector(scrollerSelector)
      if (!(root instanceof HTMLElement)) throw new Error("Session scroller not found")

      root.scrollTop = Math.max(0, root.scrollHeight - root.clientHeight - 420)
      root.dispatchEvent(new Event("scroll", { bubbles: true }))
    }, { scrollerSelector: sessionScrollerSelector })

    const before = await scroller.evaluate((el) => ({
      top: el.scrollTop,
      distanceFromBottom: el.scrollHeight - el.clientHeight - el.scrollTop,
    }))
    expect(before.distanceFromBottom).toBeGreaterThan(150)
    await expect(resumeDock).toHaveClass(/opacity-100/)

    await page.evaluate(async ({ scrollerSelector }) => {
      const root = document.querySelector(scrollerSelector)
      if (!(root instanceof HTMLElement)) throw new Error("Session scroller not found")

      const content = root.querySelector('[role="log"]')
      if (!(content instanceof HTMLElement)) throw new Error("Session content container not found")

      for (let i = 0; i < 8; i++) {
        const chunk = document.createElement("div")
        chunk.setAttribute("data-e2e-chunk", String(i))
        chunk.style.height = "120px"
        chunk.textContent = `stream chunk ${i}`
        content.appendChild(chunk)
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    }, { scrollerSelector: sessionScrollerSelector })

    const after = await scroller.evaluate((el) => ({
      top: el.scrollTop,
      distanceFromBottom: el.scrollHeight - el.clientHeight - el.scrollTop,
    }))
    expect(after.distanceFromBottom).toBeGreaterThan(150)
    expect(Math.abs(after.top - before.top)).toBeLessThan(24)

    await resumeButton.click()

    await expect
      .poll(async () => {
        return await scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)
      })
      .toBeLessThan(10)

    await expect(resumeDock).toHaveClass(/opacity-0/)
  })
})

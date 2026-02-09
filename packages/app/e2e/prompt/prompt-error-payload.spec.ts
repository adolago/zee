import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { withSession } from "../actions"

test("restores input when prompt returns 200 with an error payload", async ({ page, sdk, gotoSession }) => {
  const title = `e2e prompt error payload ${Date.now()}`

  await withSession(sdk, title, async (session) => {
    await gotoSession(session.id)

    const token = `E2E_PROMPT_ERROR_PAYLOAD_${Date.now()}`
    const forcedError = `forced failure ${Date.now()}`

    await page.route("**/session/*/message", async (route) => {
      const req = route.request()
      if (req.method() !== "POST") {
        await route.continue()
        return
      }

      // Simulate a buggy server response that returns HTTP 200 but does not
      // create a message, and instead embeds an error in the JSON body.
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          error: forcedError,
          info: null,
          parts: [],
        }),
      })
    })

    const prompt = page.locator(promptSelector)
    await prompt.click()
    await page.keyboard.type(token)
    await page.keyboard.press("Enter")

    const toast = page.locator('[data-component="toast"]').filter({ hasText: forcedError }).first()
    await expect(toast).toBeVisible()

    await expect
      .poll(async () => {
        const value = await prompt.innerText()
        return value.includes(token)
      })
      .toBe(true)

    const turn = page.locator('[data-slot="session-turn-summary-section"]').filter({ hasText: token })
    await expect(turn).toHaveCount(0)
  })
})


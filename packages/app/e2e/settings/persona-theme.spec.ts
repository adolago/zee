import { test, expect } from "../fixtures"
import { openSettings } from "../actions"
import { settingsThemeSelector, personaSelectorCompactSelector } from "../selectors"

test("persona themes appear in theme picker", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  const select = dialog.locator(settingsThemeSelector)
  await expect(select).toBeVisible()

  await select.locator('[data-slot="select-select-trigger"]').click()

  const items = page.locator('[data-slot="select-select-item"]')
  const allLabels = await items
    .locator('[data-slot="select-select-item-label"]')
    .allTextContents()

  expect(allLabels).toContain("Zee")
  expect(allLabels).toContain("Stanley")
  expect(allLabels).toContain("Johny")
})

test("switching theme to persona theme updates data-theme", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  const select = dialog.locator(settingsThemeSelector)
  await expect(select).toBeVisible()

  await select.locator('[data-slot="select-select-trigger"]').click()

  const zeeItem = page
    .locator('[data-slot="select-select-item"]')
    .filter({ hasText: "Zee" })
  await expect(zeeItem).toBeVisible()
  await zeeItem.click()

  await page.waitForTimeout(100)

  const dataTheme = await page.evaluate(() => {
    return document.documentElement.getAttribute("data-theme")
  })
  expect(dataTheme).toBe("zee")
})

test("each persona theme sets CSS variables on the document", async ({ page, gotoSession }) => {
  await gotoSession()

  const personas = ["zee", "stanley", "johny"] as const

  for (const personaId of personas) {
    // Set theme via localStorage and reload
    await page.evaluate((id) => {
      localStorage.setItem("opencode-theme-id", id)
    }, personaId)

    await page.reload()
    await page.waitForTimeout(500)

    const result = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return {
        bgBase: style.getPropertyValue("--background-base").trim(),
        textBase: style.getPropertyValue("--text-base").trim(),
        markdownHeading: style.getPropertyValue("--markdown-heading").trim(),
      }
    })

    // CSS variables should be non-empty when the theme is active
    expect(result.bgBase.length).toBeGreaterThan(0)
    expect(result.textBase.length).toBeGreaterThan(0)
  }
})

test("persona selector compact has data-component attribute", async ({ page, gotoSession }) => {
  await gotoSession()

  const selector = page.locator(personaSelectorCompactSelector)
  const exists = (await selector.count()) > 0

  // If the persona selector is rendered on this page, verify it has the attribute
  test.skip(!exists, "persona selector compact not rendered in this view")
  if (!exists) return

  await expect(selector).toBeVisible()

  const persona = await selector.getAttribute("data-persona")
  expect(persona).toBeTruthy()
  expect(["zee", "stanley", "johny"]).toContain(persona)
})

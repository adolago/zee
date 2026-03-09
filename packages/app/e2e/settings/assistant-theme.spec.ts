import { test, expect } from "../fixtures"
import { openSettings } from "../actions"
import { settingsThemeSelector, assistantSelectorCompactSelector } from "../selectors"

test("theme picker shows Selenized Dark", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  const select = dialog.locator(settingsThemeSelector)
  await expect(select).toBeVisible()

  await select.locator('[data-slot="select-select-trigger"]').click()

  const items = page.locator('[data-slot="select-select-item"]')
  const allLabels = await items.locator('[data-slot="select-select-item-label"]').allTextContents()

  expect(allLabels).toContain("Selenized Dark")
  expect(allLabels.length).toBe(1)
})

test("selecting Selenized Dark sets data-theme", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  const select = dialog.locator(settingsThemeSelector)
  await expect(select).toBeVisible()

  await select.locator('[data-slot="select-select-trigger"]').click()

  const themeItem = page.locator('[data-slot="select-select-item"]').filter({ hasText: "Selenized Dark" })
  await expect(themeItem).toBeVisible()
  await themeItem.click()

  await page.waitForTimeout(100)

  const dataTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"))
  expect(dataTheme).toBe("selenized-dark")
})

test("selenized dark theme sets CSS variables on the document", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.evaluate(() => {
    localStorage.setItem("zee-theme-id", "selenized-dark")
  })

  await page.reload()
  await page.waitForTimeout(300)

  const result = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    return {
      bgBase: style.getPropertyValue("--background-base").trim(),
      textBase: style.getPropertyValue("--text-base").trim(),
      markdownHeading: style.getPropertyValue("--markdown-heading").trim(),
    }
  })

  expect(result.bgBase.length).toBeGreaterThan(0)
  expect(result.textBase.length).toBeGreaterThan(0)
  expect(result.markdownHeading.length).toBeGreaterThan(0)
})

test("assistant selector compact has data-component attribute", async ({ page, gotoSession }) => {
  await gotoSession()

  const selector = page.locator(assistantSelectorCompactSelector)
  const exists = (await selector.count()) > 0

  test.skip(!exists, "assistant selector compact not rendered in this view")
  if (!exists) return

  await expect(selector).toBeVisible()

  const assistant = await selector.getAttribute("data-assistant")
  expect(assistant).toBe("zee")
})

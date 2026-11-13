import { expect, test, type Page } from '@playwright/test'

/** Open Options -> BYOK Settings. Tag-based locators stay valid across the E2 menu-role fix. */
async function openSettings(page: Page): Promise<void> {
  await page.locator('button:has-text("Options")').first().click()
  await page.locator('button:has-text("BYOK Settings")').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

test('E1: saving Settings with untouched defaults succeeds', async ({ page }) => {
  await page.goto('/')
  await openSettings(page)
  // Do not touch any field: the shipped default max-tokens must be submittable.
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('E1: an invalid required field auto-expands its details and shows an inline message', async ({ page }) => {
  await page.goto('/')
  await openSettings(page)
  const maxTokens = page.locator('#settings-byok1-max-tokens')
  // Push a required numeric param (inside the collapsed advanced <details>) above its max so it is
  // rangeOverflow-invalid. The control is hidden, so set it through the DOM (React-aware) rather
  // than fill(), which needs visibility. The onChange accepts >=64, so this value sticks in state.
  await maxTokens.evaluate((el) => {
    const input = el as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, '999999')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.getByRole('button', { name: 'Save settings' }).click()

  // The dialog must stay open, the collapsed details must auto-expand, the control must be
  // focused, and an inline alert must be visible (native bubbles cannot show inside details).
  await expect(page.getByRole('dialog')).toBeVisible()
  const expanded = await maxTokens.evaluate((el) => el.closest('details')?.open === true)
  expect(expanded).toBe(true)
  await expect(page.getByRole('alert')).toBeVisible()
  const focused = await maxTokens.evaluate((el) => document.activeElement === el)
  expect(focused).toBe(true)
})
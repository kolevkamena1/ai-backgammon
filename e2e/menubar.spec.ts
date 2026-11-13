import { expect, test } from '@playwright/test'

test('E2: at 375px every menu trigger is reachable and Settings/About open', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 })
  await page.goto('/')

  for (const key of ['game', 'view', 'options', 'help']) {
    const trigger = page.locator(`[data-menu-trigger="${key}"]`)
    await expect(trigger).toBeVisible()
    const box = await trigger.boundingBox()
    expect(box).not.toBeNull()
    // No horizontal clipping: the whole trigger must sit inside the 375px viewport.
    expect((box as { x: number; width: number }).x + (box as { x: number; width: number }).width).toBeLessThanOrEqual(375)
  }

  // Options -> BYOK Settings opens the settings dialog.
  await page.locator('[data-menu-trigger="options"]').click()
  await page.locator('button:has-text("BYOK Settings")').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Help -> About opens the about dialog.
  await page.locator('[data-menu-trigger="help"]').click()
  await page.locator('button:has-text("About")').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('E2: menubar arrow/Home/End navigation and aria-haspopup=menu', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')

  const activeTrigger = () =>
    page.evaluate(() => document.activeElement?.getAttribute('data-menu-trigger') ?? null)

  for (const key of ['game', 'view', 'options', 'help']) {
    await expect(page.locator(`[data-menu-trigger="${key}"]`)).toHaveAttribute('aria-haspopup', 'menu')
  }

  await page.locator('[data-menu-trigger="game"]').focus()
  await page.keyboard.press('ArrowRight')
  expect(await activeTrigger()).toBe('view')
  await page.keyboard.press('ArrowRight')
  expect(await activeTrigger()).toBe('options')
  await page.keyboard.press('End')
  expect(await activeTrigger()).toBe('help')
  await page.keyboard.press('Home')
  expect(await activeTrigger()).toBe('game')
  await page.keyboard.press('ArrowLeft')
  expect(await activeTrigger()).toBe('help')

  // Down opens the focused trigger's menu and moves focus into the panel.
  await page.locator('[data-menu-trigger="options"]').focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('[data-menu-panel="options"]')).toBeVisible()
  const focusInPanel = await page.evaluate(() => {
    const panel = document.querySelector('[data-menu-panel="options"]')
    return panel !== null && panel.contains(document.activeElement)
  })
  expect(focusInPanel).toBe(true)
})
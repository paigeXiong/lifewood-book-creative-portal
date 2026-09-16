import { test, expect, type Page } from "@playwright/test";

async function contained(page: Page) {
  const rect = await page.locator(":popover-open").boundingBox();
  const viewport = page.viewportSize()!;
  expect(rect).not.toBeNull();
  expect(rect!.x).toBeGreaterThanOrEqual(11);
  expect(rect!.y).toBeGreaterThanOrEqual(11);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width - 11);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height - 11);
}

for (const locale of ["zh-CN", "en-US"]) {
  for (const width of [1100, 390]) {
    test(`help sizing, scrolling and dismissal ${locale} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 760 }); await page.goto(`/?locale=${locale}`);
      const first = page.locator("#first button"), second = page.locator("#second button");
      await expect(first).toHaveAttribute("aria-label", locale === "zh-CN" ? /客户门户域名/ : /Customer portal domain/);
      await expect(page.locator(":popover-open")).toHaveCount(0);
      const button = await first.boundingBox(), icon = await first.locator("svg").boundingBox();
      expect(button!.width).toBe(24); expect(button!.height).toBe(24); expect(icon!.width).toBe(14); expect(icon!.height).toBe(14);
      await first.click(); await expect(first).toHaveAttribute("aria-expanded", "true"); await contained(page);
      if (info.project.name === "chromium") await page.screenshot({ path: `artifacts/help-popover-${locale}-${width}.png` });
      await first.click(); await expect(page.locator(":popover-open")).toHaveCount(0);
      await first.click(); await expect(first).toHaveAttribute("aria-expanded", "true");
      const before = await page.locator(":popover-open").boundingBox();
      await page.locator("#scrollbox").evaluate(el => { el.scrollTop = 50; });
      await expect.poll(async () => Math.round((await page.locator(":popover-open").boundingBox())!.y)).toBe(Math.round(before!.y - 50));
      await second.click(); await expect(page.locator(":popover-open")).toHaveCount(1); await expect(first).toHaveAttribute("aria-expanded", "false");
      await page.locator("#language").click(); await expect(page.locator(":popover-open")).toHaveCount(0);
      await first.focus(); await page.keyboard.press("Enter"); await expect(page.locator(":popover-open")).toHaveCount(1);
      await page.keyboard.press("Escape"); await expect(page.locator(":popover-open")).toHaveCount(0); await expect(first).toBeFocused();
      await page.keyboard.press("Space"); await expect(page.locator(":popover-open")).toHaveCount(1);
      await page.keyboard.press("Tab"); await expect(page.locator(":popover-open")).toHaveCount(0);
      await first.click(); await page.setViewportSize({ width: 340, height: 540 }); await contained(page);
      await page.locator("#scrollbox").evaluate(el => { el.scrollTop = 250; }); await expect(page.locator(":popover-open")).toHaveCount(0);
      await expect(page.locator("#submitted")).toHaveText("0");
    });
  }
  test(`Escape dismisses help before its modal ${locale}`, async ({ page }) => {
    await page.goto(`/?locale=${locale}`); await page.locator("#modal-open").click();
    const help = page.locator("#modal-help button"); await help.click(); await expect(help).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape"); await expect(page.locator(":popover-open")).toHaveCount(0); await expect(page.getByRole("dialog")).toBeVisible(); await expect(help).toBeFocused();
    await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

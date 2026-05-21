import { test, expect } from '@playwright/test';

test.describe('mobile editor entry', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('narrow viewport on / shows the landing screen, not the editor', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('button', { name: /play games/i })).toBeVisible();
        await expect(page.locator('[data-route="mobile-landing"]')).toBeVisible();
        await expect(page.getByRole('button', { name: /clear editor/i })).toBeHidden();
    });

    test('tapping Play navigates to ?play and shows the PlayerShell', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('button', { name: /play games/i }).click();
        await expect(page).toHaveURL(/\?play(?!=)/);
        await expect(page.getByLabel(/tinybit display/i)).toBeVisible({ timeout: 15_000 });
    });

    test('"Open editor anyway" reveals the editor for the rest of the session', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('button', { name: /open editor anyway/i }).click();
        await expect(page.getByRole('button', { name: /clear editor/i })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: /play games/i })).toBeHidden();
    });

    test('?play on a narrow viewport bypasses the landing and boots the player directly', async ({ page }) => {
        await page.goto('/?play');
        await expect(page.getByLabel(/tinybit display/i)).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: /play games/i })).toBeHidden();
    });
});

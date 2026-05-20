import { test, expect } from '@playwright/test';

test.describe('player route', () => {
    test('?play boots the engine launcher inside the device shell', async ({ page }) => {
        await page.goto('/?play');
        // The engine's built-in launcher cartridge runs inside the shell —
        // confirm we land on the shell and the canvas + hitboxes are present.
        await expect(page.getByLabel(/tinybit display/i)).toBeVisible({ timeout: 15_000 });
        await expect(page.getByLabel(/^a button$/i)).toBeVisible();
        await expect(page.getByLabel(/^up button$/i)).toBeVisible();
        await expect(page.getByRole('button', { name: /exit player/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /restart launcher/i })).toBeVisible();
    });

    test('Player toolbar button navigates to ?play and shows the launcher', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('button', { name: /open in player/i })).toBeVisible({ timeout: 15_000 });
        await page.getByRole('button', { name: /open in player/i }).click();
        await expect(page).toHaveURL(/\?play(?!=)/);
        await expect(page.getByLabel(/tinybit display/i)).toBeVisible({ timeout: 15_000 });
    });

    test('Exit returns to the editor', async ({ page }) => {
        await page.goto('/?play');
        await expect(page.getByRole('button', { name: /exit player/i })).toBeVisible({ timeout: 15_000 });
        await page.getByRole('button', { name: /exit player/i }).click();
        // Direct visit had no prior history — handleExit falls through to '/'.
        await expect(page).toHaveURL(/\/$/);
        await expect(page.getByRole('button', { name: /clear editor/i })).toBeVisible({ timeout: 15_000 });
    });
});

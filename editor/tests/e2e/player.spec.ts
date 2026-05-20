import { test, expect } from '@playwright/test';

test.describe('player route', () => {
    test('?play boots the engine launcher inside the device shell', async ({ page }) => {
        await page.goto('/?play');
        // The engine's built-in launcher cartridge runs inside the shell —
        // confirm we land on the shell (not on a JS gallery picker) and the
        // canvas + hitboxes are present.
        await expect(page.getByLabel(/tinybit display/i)).toBeVisible({ timeout: 15_000 });
        await expect(page.getByLabel(/^a button$/i)).toBeVisible();
        await expect(page.getByRole('button', { name: /exit player/i })).toBeVisible();
    });

    test('?play=current renders the shell with canvas and six hitboxes', async ({ page }) => {
        // First, visit the editor so localStorage has a sketch saved.
        await page.goto('/');
        // Wait for the editor toolbar to render — implies engine boot started.
        await expect(page.getByRole('button', { name: /clear editor/i })).toBeVisible({ timeout: 15_000 });
        // Editor's autosave is debounced ~500ms; wait for it to flush before navigating.
        await page.waitForTimeout(800);

        // Then navigate to ?play=current.
        await page.goto('/?play=current');
        // Canvas appears once the runtime starts.
        await expect(page.getByLabel(/tinybit display/i)).toBeVisible({ timeout: 15_000 });
        // Six button hitboxes plus an exit chip.
        await expect(page.getByLabel(/^a button$/i)).toBeVisible();
        await expect(page.getByLabel(/^b button$/i)).toBeVisible();
        await expect(page.getByLabel(/^up button$/i)).toBeVisible();
        await expect(page.getByLabel(/^down button$/i)).toBeVisible();
        await expect(page.getByLabel(/^left button$/i)).toBeVisible();
        await expect(page.getByLabel(/^right button$/i)).toBeVisible();
        await expect(page.getByRole('button', { name: /exit player/i })).toBeVisible();
    });

    test('Player toolbar button navigates to the player route', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('button', { name: /open in player/i })).toBeVisible({ timeout: 15_000 });
        await page.getByRole('button', { name: /open in player/i }).click();
        await expect(page).toHaveURL(/\?play=current/);
        await expect(page.getByLabel(/tinybit display/i)).toBeVisible({ timeout: 15_000 });
    });
});

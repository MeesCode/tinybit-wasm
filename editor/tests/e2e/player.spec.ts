import { test, expect } from '@playwright/test';

test.describe('player route', () => {
    test('?play renders the gallery picker with at least one cartridge', async ({ page }) => {
        await page.goto('/?play');
        await expect(page.getByRole('heading', { name: /pick a cartridge/i })).toBeVisible();
        // The shipped sample cartridges in editor/src/cartridges/ should populate the gallery.
        // Allow up to 15s for wasm boot + gallery load.
        await expect(page.locator('button:has(img)').first()).toBeVisible({ timeout: 15_000 });
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

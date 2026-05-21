import { test, expect } from '@playwright/test';

test.describe('Script API modal', () => {
    test('Insert drops the signature at the script cursor and closes the modal', async ({ page }) => {
        await page.addInitScript(() => localStorage.clear());
        await page.goto('/');

        const editor = page.locator('.cm-content');
        await expect(editor).toContainText('hello, world');

        // Replace the script with a single comment so we have a known cursor position at end-of-doc.
        await editor.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.type('-- start', { delay: 1 });
        await page.keyboard.press('End');

        // Open the script-help modal.
        await page.getByRole('button', { name: /script api help/i }).click();
        const dialog = page.getByRole('dialog', { name: /script api/i });
        await expect(dialog).toBeVisible();

        // Switch to Drawing and Insert cls.
        await dialog.getByRole('tab', { name: /^Drawing\b/ }).click();
        await dialog.getByRole('button', { name: /^insert cls at cursor$/i }).click();

        // Modal closes; cls() lands after `-- start`.
        await expect(dialog).not.toBeVisible();
        await expect(editor).toContainText('-- startcls()');

        // The caret should be positioned right after cls() — typing now appends.
        await page.keyboard.type(' -- after', { delay: 1 });
        await expect(editor).toContainText('-- startcls() -- after');
    });

    test('search filters the sidebar and the right pane', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('button', { name: /script api help/i }).click();

        const dialog = page.getByRole('dialog', { name: /script api/i });
        await expect(dialog).toBeVisible();

        const search = dialog.getByRole('searchbox', { name: /search script api/i });
        await search.fill('sprite');

        // Categories without matches disappear from the sidebar.
        await expect(dialog.getByRole('tab', { name: /^Hooks\b/ })).toHaveCount(0);
        await expect(dialog.getByRole('tab', { name: /^Color\b/ })).toHaveCount(0);

        // Drawing tab survives and the sprite entry is visible.
        await expect(dialog.getByRole('tab', { name: /^Drawing\b/ })).toBeVisible();
        await expect(dialog.getByText('sprite', { exact: true })).toBeVisible();

        // The Insert button for sprite is reachable.
        await expect(dialog.getByRole('button', { name: /^insert sprite at cursor$/i })).toBeVisible();
    });
});

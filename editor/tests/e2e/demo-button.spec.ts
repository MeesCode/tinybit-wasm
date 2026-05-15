import { test, expect } from '@playwright/test';

test('Demo button reloads the Lucky Leprechaun demo over an existing edited sketch', async ({ page }) => {
    // Seed an empty sketch so we don't start on the demo.
    await page.addInitScript(() => {
        localStorage.setItem('tinybit-editor/sketch/v1', JSON.stringify({
            script: '-- existing edits',
            title: '',
            author: '',
            sprite_b64: null,
            cover_b64: null,
        }));
    });
    await page.goto('/');

    const editor = page.locator('.cm-content');
    await expect(editor).toContainText('existing edits');
    await expect(editor).not.toContainText('Lucky Leprechaun');

    // Cancel keeps the existing edits.
    await page.getByRole('button', { name: /load demo/i }).click();
    await expect(page.getByRole('dialog', { name: /load demo/i })).toBeVisible();
    await page.getByRole('dialog', { name: /load demo/i }).getByRole('button', { name: /^cancel$/i }).click();
    await expect(editor).toContainText('existing edits');

    // Confirm replaces with the demo.
    await page.getByRole('button', { name: /load demo/i }).click();
    await page.getByRole('dialog', { name: /load demo/i }).getByRole('button', { name: /^load demo$/i }).click();
    await expect(editor).toContainText('Lucky Leprechaun');
    await expect(editor).not.toContainText('existing edits');
});

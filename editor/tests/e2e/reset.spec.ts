import { test, expect } from '@playwright/test';

test('first run loads the Star Catcher demo', async ({ page, context }) => {
    await context.clearCookies();
    await page.addInitScript(() => localStorage.clear());

    await page.goto('/');

    // CodeMirror renders the script across multiple .cm-line nodes — query
    // the editor container and assert on its accumulated text.
    const editor = page.locator('.cm-content');
    await expect(editor).toContainText('Star Catcher');
    await expect(editor).toContainText('--@music');

    // The Cartridge tab shows the demo's title/author.
    await page.getByRole('tab', { name: /cartridge/i }).click();
    await expect(page.getByRole('textbox', { name: /title/i })).toHaveValue('Star Catcher');
    await expect(page.getByRole('textbox', { name: /author/i })).toHaveValue('TinyBit');
});

test('reset reverts edits back to the demo, cancel keeps them', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');

    // Wait for the demo to load.
    const editor = page.locator('.cm-content');
    await expect(editor).toContainText('Star Catcher');

    // Replace the script with junk.
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('-- JUNK CONTENT', { delay: 1 });
    await expect(editor).toContainText('JUNK CONTENT');
    await expect(editor).not.toContainText('Star Catcher');

    // Cancel does nothing.
    await page.getByRole('button', { name: /reset to demo/i }).click();
    await expect(page.getByRole('dialog', { name: /reset to demo/i })).toBeVisible();
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(editor).toContainText('JUNK CONTENT');

    // Confirm reverts.
    await page.getByRole('button', { name: /reset to demo/i }).click();
    await page.getByRole('dialog', { name: /reset to demo/i }).getByRole('button', { name: /^reset$/i }).click();
    await expect(editor).toContainText('Star Catcher');
    await expect(editor).not.toContainText('JUNK CONTENT');
});

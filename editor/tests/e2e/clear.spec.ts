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

test('clear empties the editor and persists across reload', async ({ page }) => {
    // Navigate once to prime the origin, then clear storage so the demo loads
    // on the next navigation — but addInitScript is NOT used here because it
    // would fire again on page.reload() and wipe the persisted empty state.
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/');

    // Demo loads on fresh start.
    const editor = page.locator('.cm-content');
    await expect(editor).toContainText('Star Catcher');

    // Cancel keeps the demo intact.
    await page.getByRole('button', { name: /clear editor/i }).click();
    await expect(page.getByRole('dialog', { name: /clear editor/i })).toBeVisible();
    await page.getByRole('dialog', { name: /clear editor/i }).getByRole('button', { name: /cancel/i }).click();
    await expect(editor).toContainText('Star Catcher');

    // Confirm empties the editor.
    await page.getByRole('button', { name: /clear editor/i }).click();
    await page.getByRole('dialog', { name: /clear editor/i }).getByRole('button', { name: /^clear$/i }).click();
    await expect(editor).not.toContainText('Star Catcher');
    // Editor body is empty (CodeMirror shows a single placeholder line).
    const text = (await editor.textContent()) ?? '';
    expect(text.trim()).toBe('');

    // Reload — empty state must persist (NOT the demo).
    await page.reload();
    const editorAfter = page.locator('.cm-content');
    await expect(editorAfter).not.toContainText('Star Catcher');
    const textAfter = (await editorAfter.textContent()) ?? '';
    expect(textAfter.trim()).toBe('');
});

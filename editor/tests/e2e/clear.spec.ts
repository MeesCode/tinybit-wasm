import { test, expect } from '@playwright/test';

test('first run shows the hello-world skeleton', async ({ page, context }) => {
    await context.clearCookies();
    await page.addInitScript(() => localStorage.clear());

    await page.goto('/');

    const editor = page.locator('.cm-content');
    await expect(editor).toContainText('hello, world');
    await expect(editor).toContainText('function _draw');

    // Title and author are empty on first run.
    await page.getByRole('tab', { name: /cartridge/i }).click();
    await expect(page.getByRole('textbox', { name: /title/i })).toHaveValue('');
    await expect(page.getByRole('textbox', { name: /author/i })).toHaveValue('');
});

test('clear restores the skeleton and persists across reload', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/');

    const editor = page.locator('.cm-content');
    await expect(editor).toContainText('hello, world');

    // Type something into the editor to mutate state.
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('-- mutated', { delay: 1 });
    await expect(editor).toContainText('mutated');
    await expect(editor).not.toContainText('hello, world');

    // Cancel keeps the mutation.
    await page.getByRole('button', { name: /clear editor/i }).click();
    await expect(page.getByRole('dialog', { name: /clear editor/i })).toBeVisible();
    await page.getByRole('dialog', { name: /clear editor/i }).getByRole('button', { name: /cancel/i }).click();
    await expect(editor).toContainText('mutated');

    // Confirm restores the skeleton.
    await page.getByRole('button', { name: /clear editor/i }).click();
    await page.getByRole('dialog', { name: /clear editor/i }).getByRole('button', { name: /^clear$/i }).click();
    await expect(editor).toContainText('hello, world');
    await expect(editor).not.toContainText('mutated');

    await page.reload();
    const editorAfter = page.locator('.cm-content');
    await expect(editorAfter).toContainText('hello, world');
});

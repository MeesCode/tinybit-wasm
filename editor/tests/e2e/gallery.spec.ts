import { test, expect } from '@playwright/test';
import { copyFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE   = join(__dirname, '..', 'fixtures', 'upload-cart.tb.png');
const CARTRIDGE_DIR = join(__dirname, '..', '..', 'src', 'cartridges');
const DROPPED   = join(CARTRIDGE_DIR, '_gallery-e2e.tb.png');

test.describe('Gallery modal', () => {
    test('opens, lists no cartridges when folder is empty', async ({ page, context }) => {
        // Make sure no stray fixture cartridge is in the folder from a prior aborted run.
        if (existsSync(DROPPED)) unlinkSync(DROPPED);

        await context.clearCookies();
        await page.addInitScript(() => localStorage.clear());
        await page.goto('/');

        await page.getByRole('button', { name: /gallery/i }).click();
        const dialog = page.getByRole('dialog', { name: /choose a cartridge/i });
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(/no cartridges in/i);
        await dialog.getByRole('button', { name: /cancel/i }).click();
        await expect(dialog).not.toBeVisible();
    });

    test('loads a cartridge from a populated gallery (silent over skeleton)', async ({ page, context }) => {
        if (!existsSync(FIXTURE)) test.skip(true, 'fixture upload-cart.tb.png missing — run editor/tests/fixtures/make-cart-fixture.mjs');
        if (!existsSync(CARTRIDGE_DIR)) mkdirSync(CARTRIDGE_DIR, { recursive: true });
        copyFileSync(FIXTURE, DROPPED);

        try {
            await context.clearCookies();
            await page.addInitScript(() => localStorage.clear());
            // Give Vite a moment to rescan the glob.
            await page.waitForTimeout(800);
            await page.goto('/');

            const editor = page.locator('.cm-content');
            await expect(editor).toContainText('hello, world');

            await page.getByRole('button', { name: /gallery/i }).click();
            const dialog = page.getByRole('dialog', { name: /choose a cartridge/i });
            await expect(dialog).toBeVisible();

            // At least one card; click the first one (excluding Cancel).
            const card = dialog.getByRole('button').filter({ hasNotText: /cancel/i }).first();
            await expect(card).toBeVisible();
            await card.click();

            // Modal closes; no confirmation (we were on the untouched skeleton).
            await expect(dialog).not.toBeVisible();
            // Editor now shows the fixture's content rather than the skeleton's hello, world line.
            await expect(editor).not.toContainText('hello, world');
        } finally {
            if (existsSync(DROPPED)) unlinkSync(DROPPED);
        }
    });

    test('shows the replace-confirm when picking a card over a modified sketch', async ({ page, context }) => {
        if (!existsSync(FIXTURE)) test.skip(true, 'fixture upload-cart.tb.png missing — run editor/tests/fixtures/make-cart-fixture.mjs');
        if (!existsSync(CARTRIDGE_DIR)) mkdirSync(CARTRIDGE_DIR, { recursive: true });
        copyFileSync(FIXTURE, DROPPED);

        try {
            await context.clearCookies();
            await page.addInitScript(() => localStorage.clear());
            await page.waitForTimeout(800);
            await page.goto('/');

            // Modify the script so isUntouchedSkeleton returns false.
            const editor = page.locator('.cm-content');
            await editor.click();
            await page.keyboard.press('Control+A');
            await page.keyboard.type('-- I have edits', { delay: 1 });
            await expect(editor).toContainText('I have edits');

            await page.getByRole('button', { name: /gallery/i }).click();
            const gallery = page.getByRole('dialog', { name: /choose a cartridge/i });
            const card = gallery.getByRole('button').filter({ hasNotText: /cancel/i }).first();
            await card.click();

            // Gallery closes, UploadConfirm appears.
            await expect(gallery).not.toBeVisible();
            const upload = page.getByRole('dialog', { name: /replace/i });
            await expect(upload).toBeVisible();

            // Cancel the replace — edits survive.
            await upload.getByRole('button', { name: /cancel/i }).click();
            await expect(upload).not.toBeVisible();
            await expect(editor).toContainText('I have edits');
        } finally {
            if (existsSync(DROPPED)) unlinkSync(DROPPED);
        }
    });
});

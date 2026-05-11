import { test, expect } from '@playwright/test';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH    = join(__dirname, '..', '..', 'public', 'tinybit_wasm.wasm');
const CART_FIXTURE = join(__dirname, '..', 'fixtures', 'upload-cart.tb.png');

test.describe('cartridge upload', () => {
    test.beforeEach(async () => {
        test.skip(!existsSync(WASM_PATH), 'WASM not built — run scripts/build.sh first');
        test.skip(!existsSync(CART_FIXTURE), 'Cartridge fixture missing — run editor/tests/fixtures/make-cart-fixture.mjs');
    });

    test('open + replace populates all five fields and round-trips download', async ({ page }) => {
        await page.goto('/');

        // Trigger the hidden file input via the Open button → setInputFiles.
        // Since the input is hidden (display:none), we set files directly via testid.
        await page.getByTestId('open-input').setInputFiles(CART_FIXTURE);

        // Confirm dialog appears with the filename.
        await expect(page.getByText('upload-cart.tb.png')).toBeVisible();
        await page.getByRole('button', { name: /replace/i }).click();

        // Console pane logs the loaded title/author.
        await expect(page.getByText(/Loaded 'upload-fixture' by e2e/)).toBeVisible({ timeout: 5_000 });

        // Switch to Cartridge tab; fields should reflect the upload.
        await page.getByRole('tab', { name: /cartridge/i }).click();
        await expect(page.getByLabel('Title', { exact: true })).toHaveValue('upload-fixture');
        await expect(page.getByLabel('Author', { exact: true })).toHaveValue('e2e');

        // Switch to script tab and verify the script was loaded.
        await page.getByRole('tab', { name: /script\.lua/i }).click();
        await expect(page.locator('.cm-content')).toContainText('pset(10, 10, 0xFFFF)');

        // Download the cartridge and confirm we get bytes back.
        const dlPromise = page.waitForEvent('download');
        await page.getByRole('button', { name: /download/i }).click();
        const dl = await dlPromise;
        expect(dl.suggestedFilename()).toMatch(/upload-fixture\.tb\.png$/);
    });

    test('uploading a non-256×256 PNG is rejected before the confirm dialog', async ({ page }) => {
        await page.goto('/');
        // sprite-128.png is 128×128 — should be rejected as a cartridge.
        await page.getByTestId('open-input').setInputFiles(join(__dirname, '..', 'fixtures', 'sprite-128.png'));
        await expect(page.getByText(/expected 256×256/i)).toBeVisible({ timeout: 5_000 });
        // No confirm dialog should appear.
        await expect(page.getByRole('button', { name: /replace/i })).toHaveCount(0);
    });
});

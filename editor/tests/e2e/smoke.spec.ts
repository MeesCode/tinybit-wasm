import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const WASM_PATH = join(__dirname, '..', '..', 'public', 'tinybit_wasm.wasm');

test('boots and renders the editor shell', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /download/i })).toBeVisible();
});

test('encode + play paints a non-empty canvas', async ({ page }) => {
    // Skip if the WASM build doesn't have the encoder exports yet.
    if (!existsSync(WASM_PATH)) test.skip(true, 'WASM not built — run scripts/build.sh first');
    const bytes = readFileSync(WASM_PATH);
    const looksLikeEncoder = bytes.toString('binary').includes('tb_enc_run');
    test.skip(!looksLikeEncoder, 'WASM build missing tb_enc_run — merge feat/tb-encoder');

    await page.goto('/');

    // Switch to cartridge tab; upload sprite + cover.
    await page.getByRole('tab', { name: /cartridge/i }).click();
    await page.getByTestId('sprite-input').setInputFiles(join(__dirname, '..', 'fixtures', 'sprite-128.png'));
    await page.getByTestId('cover-input').setInputFiles(join(__dirname, '..', 'fixtures', 'cover-128.png'));

    // Replace the default script with one that lights pixel (10,10).
    await page.getByRole('tab', { name: /script/i }).click();
    const editorEl = page.locator('.cm-content');
    await editorEl.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('function _draw()\n  pset(10, 10, 0xFFFF)\nend\n', { delay: 1 });

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    // Allow several frames to elapse.
    await page.waitForTimeout(200);

    // Read the canvas pixel.
    const nonZero = await page.evaluate(() => {
        const c = document.querySelector('canvas') as HTMLCanvasElement | null;
        if (!c) return false;
        const ctx = c.getContext('2d');
        if (!ctx) return false;
        const data = ctx.getImageData(10, 10, 1, 1).data;
        return data[0] !== 0 || data[1] !== 0 || data[2] !== 0;
    });
    expect(nonZero).toBe(true);
    void REPO_ROOT;
});

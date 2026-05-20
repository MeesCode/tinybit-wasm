import { test, expect } from '@playwright/test';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(__dirname, '..', '..', 'public', 'tinybit_wasm.wasm');

test.describe('spritesheet editor', () => {
    test.beforeEach(async () => {
        test.skip(!existsSync(WASM_PATH), 'WASM not built — run scripts/build.sh first');
    });

    test('paint a pixel, Play, and the pixel appears on the running canvas', async ({ page }) => {
        await page.goto('/');

        // Wait for runtime to boot — the Play button is rendered before runtime is ready,
        // but the store handles only exist after the App effect runs. Wait for them.
        await page.waitForFunction(() => 'useSketchStore' in window && 'useSpriteEditorStore' in window);

        // Write a Lua script that copies sprite cell (5,5) to display pixel (5,5).
        await page.getByRole('tab', { name: /script/i }).click();
        const editor = page.locator('.cm-content');
        await editor.click();
        await page.keyboard.press('Control+A');
        // sprite(srcX, srcY, srcW, srcH, dstX, dstY, dstW, dstH) copies spritesheet → display.
        await page.keyboard.type('function _draw() cls(0x0000); sprite(5,5,1,1,5,5,1,1) end\n', { delay: 1 });

        // Initialise an empty 128x128 RGBA8 spritePixels buffer with one bright-red pixel at (5,5).
        await page.evaluate(() => {
            // @ts-expect-error — exposed via App.tsx in dev mode
            const sk = window.useSketchStore.getState();
            void sk; // referenced only to confirm the handle exists
            const pixels = new Uint8Array(128 * 128 * 4);
            const o = (5 * 128 + 5) * 4;
            pixels[o]     = 0xFF; // R
            pixels[o + 1] = 0x00; // G
            pixels[o + 2] = 0x00; // B
            pixels[o + 3] = 0xFF; // A
            // Direct setState bypasses setSpriteFromPng (we want to skip PNG round-trip here).
            // @ts-expect-error
            window.useSketchStore.setState({ spritePixels: pixels });
        });

        // Hit Play.
        await page.getByRole('button', { name: 'Play', exact: true }).click();
        await page.waitForTimeout(250);  // let a handful of frames elapse

        // Read display pixel (5,5). 128×128 canvas may be displayed at a larger CSS size,
        // so use the internal canvas resolution: query the canvas whose internal width is 128.
        const px = await page.evaluate(() => {
            const canvases = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[];
            // Find the player canvas (128x128 internal resolution).
            const c = canvases.find((cv) => cv.width === 128 && cv.height === 128);
            if (!c) return null;
            const ctx = c.getContext('2d');
            if (!ctx) return null;
            const d = ctx.getImageData(5, 5, 1, 1).data;
            return [d[0], d[1], d[2], d[3]];
        });
        expect(px).not.toBeNull();
        // Dominant red — channel R should be > G and > B by a clear margin.
        expect(px![0]).toBeGreaterThan(150);
        expect(px![0]).toBeGreaterThan(px![1]);
        expect(px![0]).toBeGreaterThan(px![2]);
    });
});

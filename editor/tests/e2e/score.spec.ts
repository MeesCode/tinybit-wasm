import { test, expect } from '@playwright/test';

test('score tab: insert new score and round-trip to script', async ({ page }) => {
    // Seed an empty sketch so the demo-on-first-boot branch is NOT taken.
    await page.addInitScript(() => {
        localStorage.setItem('tinybit-editor/sketch/v1', JSON.stringify({
            script: '',
            title: '',
            author: '',
            sprite_b64: null,
            cover_b64: null,
        }));
    });
    await page.goto('/');
    await page.waitForFunction(() => (window as any).useSketchStore !== undefined);

    // Switch to Score tab.
    await page.getByRole('tab', { name: 'score' }).click();

    // Empty state.
    await expect(page.getByText(/no scores yet/i)).toBeVisible();

    // Insert a new score.
    await page.getByRole('button', { name: /\+ new music/i }).click();

    // A chip for score_1 should appear.
    await expect(page.getByRole('button', { name: /^music_1$/ })).toBeVisible();

    // The script should now contain the snippet.
    const script: string = await page.evaluate(() => (window as any).useSketchStore.getState().script);
    expect(script).toContain('--@music: music_1');
    expect(script).toContain('[[\nL:1/4\nK:C\nC D E F |\n]]');

    // Type into the ABC editor.
    // Note: aria-label is set directly on the .cm-content element via EditorView.contentAttributes.
    const abcEditor = page.locator('[aria-label="ABC score editor"]');
    await abcEditor.click();
    await page.keyboard.press('End'); // cursor to EOL of whatever line we landed on
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' | G A B c');

    // Wait for the 300 ms debounce + write.
    await page.waitForTimeout(500);

    const updated: string = await page.evaluate(() => (window as any).useSketchStore.getState().script);
    expect(updated).toMatch(/G A B c/);

    // Click Play in the score transport bar (aria-label="play", lowercase, as set by ScoreTab).
    await page.getByRole('button', { name: 'play', exact: true }).click();
    await page.waitForTimeout(300);
    // Click Stop in the score transport bar (aria-label="stop", lowercase).
    await page.getByRole('button', { name: 'stop', exact: true }).click();
});

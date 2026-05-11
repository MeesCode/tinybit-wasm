import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CartridgeTab } from './CartridgeTab';
import { useSketchStore } from '../state/sketchStore';
import { encodePixelsToPng } from '../sprite/png';

// Minimal IHDR-only PNG — readPngSize sees the dimensions, but decoders reject for size mismatch.
function ihdrOnlyPngBytes(w: number, h: number): Uint8Array {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52];
    const wb = [(w >>> 24) & 0xff, (w >>> 16) & 0xff, (w >>> 8) & 0xff, w & 0xff];
    const hb = [(h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff];
    return Uint8Array.from([...sig, ...ihdr, ...wb, ...hb, 8, 6, 0, 0, 0, 0, 0, 0, 0]);
}

beforeEach(() => useSketchStore.getState().reset());

describe('CartridgeTab', () => {
    test('typing the title writes to the sketch store', async () => {
        render(<CartridgeTab />);
        const input = screen.getByLabelText(/title/i);
        await userEvent.type(input, 'flappy');
        expect(useSketchStore.getState().title).toBe('flappy');
    });

    test('valid 128x128 sprite upload commits bytes (and spritePixels) to the store', async () => {
        render(<CartridgeTab />);
        const pixels = new Uint8Array(128 * 128 * 4);
        const realPng = await encodePixelsToPng(pixels);
        // pngjs returns a Uint8Array backed by a Node Buffer pool with a non-zero byteOffset.
        // Slice to a fresh ArrayBuffer so the test's arrayBuffer() mock yields just the PNG.
        const pngArrayBuffer = realPng.slice().buffer;
        const file = new File([new Uint8Array(pngArrayBuffer) as BlobPart], 'sprite.png', { type: 'image/png' });
        Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(pngArrayBuffer) });
        const input = screen.getByTestId('sprite-input') as HTMLInputElement;
        await fireEvent.change(input, { target: { files: [file] } });
        await vi.waitFor(() => {
            expect(useSketchStore.getState().sprite).not.toBeNull();
            expect(useSketchStore.getState().spritePixels).not.toBeNull();
        });
    });

    test('64x64 sprite upload shows an error and does not commit', async () => {
        render(<CartridgeTab />);
        const badBytes = ihdrOnlyPngBytes(64, 64);
        const bad = new File([badBytes as BlobPart], 'bad.png', { type: 'image/png' });
        Object.defineProperty(bad, 'arrayBuffer', { value: () => Promise.resolve(badBytes.buffer) });
        const input = screen.getByTestId('sprite-input') as HTMLInputElement;
        await fireEvent.change(input, { target: { files: [bad] } });
        await screen.findByText(/must be 128×128/i);
        expect(useSketchStore.getState().sprite).toBeNull();
    });
});

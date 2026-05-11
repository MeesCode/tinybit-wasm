import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CartridgeTab } from './CartridgeTab';
import { useSketchStore } from '../state/sketchStore';

function pngBytes(w: number, h: number): Uint8Array {
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

    test('valid 128x128 sprite upload commits bytes to the store', async () => {
        render(<CartridgeTab />);
        const file = new File([pngBytes(128, 128) as BlobPart], 'sprite.png', { type: 'image/png' });
        Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(file.size === 0 ? new ArrayBuffer(0) : new Uint8Array(pngBytes(128, 128)).buffer) });
        const input = screen.getByTestId('sprite-input') as HTMLInputElement;
        await fireEvent.change(input, { target: { files: [file] } });
        await vi.waitFor(() => {
            expect(useSketchStore.getState().sprite).not.toBeNull();
        });
    });

    test('64x64 sprite upload shows an error and does not commit', async () => {
        render(<CartridgeTab />);
        const bad = new File([pngBytes(64, 64) as BlobPart], 'bad.png', { type: 'image/png' });
        Object.defineProperty(bad, 'arrayBuffer', { value: () => Promise.resolve(new Uint8Array(pngBytes(64, 64)).buffer) });
        const input = screen.getByTestId('sprite-input') as HTMLInputElement;
        await fireEvent.change(input, { target: { files: [bad] } });
        await screen.findByText(/must be 128×128/i);
        expect(useSketchStore.getState().sprite).toBeNull();
    });
});

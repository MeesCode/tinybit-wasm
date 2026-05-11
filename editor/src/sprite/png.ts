const SPRITE_SIZE = 128;

/** True when running under Node.js (Vitest / SSR), false in the browser. */
const IS_NODE =
    typeof process !== 'undefined' && typeof process.versions?.node === 'string';

// ─── Node.js path (tests) ────────────────────────────────────────────────────
// Uses `pngjs` for lossless RGBA8 encode/decode without premultiplied-alpha
// precision loss (node-canvas stores pixels premultiplied internally).

async function nodeDecodeToPixels(
    bytes: Uint8Array,
): Promise<{ width: number; height: number; pixels: Uint8Array }> {
    const { PNG } = await import('pngjs');
    const png = PNG.sync.read(Buffer.from(bytes));
    return {
        width: png.width,
        height: png.height,
        pixels: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength),
    };
}

async function nodeEncodeToPng(
    pixels: Uint8Array,
    width: number,
    height: number,
): Promise<Uint8Array> {
    const { PNG } = await import('pngjs');
    const png = new PNG({ width, height, filterType: 4, colorType: 6, bitDepth: 8 });
    png.data = Buffer.from(pixels);
    const buf = PNG.sync.write(png);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

// ─── Browser path ─────────────────────────────────────────────────────────────
// Uses the standard DOM canvas / Image APIs via offscreen <canvas>.

async function browserDecodeToPixels(
    bytes: Uint8Array,
): Promise<{ width: number; height: number; pixels: Uint8Array }> {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error('Failed to decode PNG'));
            i.src = url;
        });
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('2D canvas unavailable');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, c.width, c.height).data;
        return { width: c.width, height: c.height, pixels: new Uint8Array(data) };
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function browserEncodeToPng(
    pixels: Uint8Array,
    width: number,
    height: number,
): Promise<Uint8Array> {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
        c.toBlob((b) => resolve(b), 'image/png'),
    );
    if (!blob) throw new Error('Failed to encode PNG');
    return new Uint8Array(await blob.arrayBuffer());
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function decodePngToPixels(
    bytes: Uint8Array,
): Promise<{ width: number; height: number; pixels: Uint8Array }> {
    const result = IS_NODE
        ? await nodeDecodeToPixels(bytes)
        : await browserDecodeToPixels(bytes);

    if (result.width !== SPRITE_SIZE || result.height !== SPRITE_SIZE) {
        throw new Error(
            `Sprite PNG must be ${SPRITE_SIZE}×${SPRITE_SIZE} (got ${result.width}×${result.height})`,
        );
    }
    return result;
}

export async function encodePixelsToPng(
    pixels: Uint8Array,
    width = SPRITE_SIZE,
    height = SPRITE_SIZE,
): Promise<Uint8Array> {
    if (pixels.length !== width * height * 4)
        throw new Error('pixels length does not match dimensions');

    return IS_NODE
        ? nodeEncodeToPng(pixels, width, height)
        : browserEncodeToPng(pixels, width, height);
}

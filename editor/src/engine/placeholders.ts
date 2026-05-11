const SIZE = 128;
let cachedCover:  Uint8Array | null = null;
let cachedSprite: Uint8Array | null = null;

async function canvasToPng(draw: (ctx: OffscreenCanvasRenderingContext2D) => void): Promise<Uint8Array> {
    const canvas = new OffscreenCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
    draw(ctx);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
}

export async function getPlaceholderCover(): Promise<Uint8Array> {
    if (cachedCover) return cachedCover;
    cachedCover = await canvasToPng((ctx) => {
        ctx.fillStyle = '#ED225D';
        ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('TINYBIT', SIZE / 2, SIZE / 2);
    });
    return cachedCover;
}

export async function getPlaceholderSprite(): Promise<Uint8Array> {
    if (cachedSprite) return cachedSprite;
    cachedSprite = await canvasToPng((ctx) => {
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.fillStyle = '#444';
        for (let y = 0; y < SIZE; y += 8) {
            for (let x = 0; x < SIZE; x += 8) {
                if (((x ^ y) >> 3) & 1) ctx.fillRect(x, y, 8, 8);
            }
        }
    });
    return cachedSprite;
}

import type { DirtyRect } from './history';

const SIZE = 128;

function setPixel(buf: Uint8Array, x: number, y: number, rgba: number): void {
    const o = (y * SIZE + x) * 4;
    buf[o]     = (rgba >>> 24) & 0xFF;
    buf[o + 1] = (rgba >>> 16) & 0xFF;
    buf[o + 2] = (rgba >>>  8) & 0xFF;
    buf[o + 3] =  rgba         & 0xFF;
}

export function readPixel(buf: Uint8Array, x: number, y: number): number {
    const o = (y * SIZE + x) * 4;
    return ((buf[o] << 24) | (buf[o+1] << 16) | (buf[o+2] << 8) | buf[o+3]) >>> 0;
}

export function stampBrush(buf: Uint8Array, cx: number, cy: number, size: number, rgba: number): DirtyRect {
    const half = Math.floor(size / 2);
    const x0 = Math.max(0, cx - half), y0 = Math.max(0, cy - half);
    const x1 = Math.min(SIZE - 1, cx + (size - 1 - half));
    const y1 = Math.min(SIZE - 1, cy + (size - 1 - half));
    for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
            setPixel(buf, x, y, rgba);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function drawLine(buf: Uint8Array, x0: number, y0: number, x1: number, y1: number, size: number, rgba: number): DirtyRect {
    let x = x0, y = y0;
    const dx = Math.abs(x1 - x), dy = -Math.abs(y1 - y);
    const sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1;
    let err = dx + dy;
    let bx0 = SIZE, by0 = SIZE, bx1 = -1, by1 = -1;
    while (true) {
        const r = stampBrush(buf, x, y, size, rgba);
        if (r.x < bx0) bx0 = r.x;
        if (r.y < by0) by0 = r.y;
        if (r.x + r.w - 1 > bx1) bx1 = r.x + r.w - 1;
        if (r.y + r.h - 1 > by1) by1 = r.y + r.h - 1;
        if (x === x1 && y === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x += sx; }
        if (e2 <= dx) { err += dx; y += sy; }
    }
    return { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 };
}

export function floodFill(buf: Uint8Array, sx: number, sy: number, rgba: number): DirtyRect | null {
    const target = readPixel(buf, sx, sy);
    if (target === rgba) return null;
    const visited = new Uint8Array(SIZE * SIZE);
    const stack: number[] = [sy * SIZE + sx];
    let bx0 = SIZE, by0 = SIZE, bx1 = -1, by1 = -1;
    while (stack.length) {
        const i = stack.pop()!;
        if (visited[i]) continue;
        const x = i % SIZE, y = Math.floor(i / SIZE);
        if (readPixel(buf, x, y) !== target) { visited[i] = 1; continue; }
        visited[i] = 1;
        setPixel(buf, x, y, rgba);
        if (x < bx0) bx0 = x;
        if (y < by0) by0 = y;
        if (x > bx1) bx1 = x;
        if (y > by1) by1 = y;
        if (x > 0)         stack.push(i - 1);
        if (x < SIZE - 1)  stack.push(i + 1);
        if (y > 0)         stack.push(i - SIZE);
        if (y < SIZE - 1)  stack.push(i + SIZE);
    }
    if (bx1 < 0) return null;
    return { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 };
}

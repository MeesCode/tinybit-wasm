export const ZOOM_LEVELS = [1, 2, 4, 8, 16, 24, 32] as const;
export type Zoom = (typeof ZOOM_LEVELS)[number];

export interface Viewport { zoom: Zoom; pan: { x: number; y: number }; }

const SPRITE_SIZE = 128;

function spriteRect(vp: Viewport, canvasW: number, canvasH: number) {
    const drawW = SPRITE_SIZE * vp.zoom;
    const drawH = SPRITE_SIZE * vp.zoom;
    const x = Math.floor((canvasW - drawW) / 2) + vp.pan.x * vp.zoom;
    const y = Math.floor((canvasH - drawH) / 2) + vp.pan.y * vp.zoom;
    return { x, y, w: drawW, h: drawH };
}

export function screenToPixel(vp: Viewport, sx: number, sy: number, canvasW: number, canvasH: number): { x: number; y: number } | null {
    const r = spriteRect(vp, canvasW, canvasH);
    const px = Math.floor((sx - r.x) / vp.zoom);
    const py = Math.floor((sy - r.y) / vp.zoom);
    if (px < 0 || py < 0 || px >= SPRITE_SIZE || py >= SPRITE_SIZE) return null;
    return { x: px, y: py };
}

export function pixelToScreen(vp: Viewport, px: number, py: number, canvasW: number, canvasH: number): { x: number; y: number } {
    const r = spriteRect(vp, canvasW, canvasH);
    return { x: r.x + px * vp.zoom + Math.floor(vp.zoom / 2), y: r.y + py * vp.zoom + Math.floor(vp.zoom / 2) };
}

export function nextZoom(z: Zoom): Zoom {
    const i = ZOOM_LEVELS.indexOf(z);
    return ZOOM_LEVELS[Math.min(i + 1, ZOOM_LEVELS.length - 1)];
}

export function prevZoom(z: Zoom): Zoom {
    const i = ZOOM_LEVELS.indexOf(z);
    return ZOOM_LEVELS[Math.max(i - 1, 0)];
}

export function anchoredZoom(vp: Viewport, newZoom: Zoom, anchor: { sx: number; sy: number; canvasW: number; canvasH: number }): Viewport {
    const r = spriteRect(vp, anchor.canvasW, anchor.canvasH);
    const pxF = (anchor.sx - r.x) / vp.zoom;
    const pyF = (anchor.sy - r.y) / vp.zoom;
    const baseX = Math.floor((anchor.canvasW - SPRITE_SIZE * newZoom) / 2);
    const baseY = Math.floor((anchor.canvasH - SPRITE_SIZE * newZoom) / 2);
    const newPanX = (anchor.sx - baseX) / newZoom - pxF;
    const newPanY = (anchor.sy - baseY) / newZoom - pyF;
    return { zoom: newZoom, pan: { x: newPanX, y: newPanY } };
}

export function fitZoom(canvasW: number, canvasH: number): Zoom {
    const max = Math.min(canvasW, canvasH) / SPRITE_SIZE;
    let best: Zoom = 1;
    for (const z of ZOOM_LEVELS) if (z <= max) best = z;
    return best;
}

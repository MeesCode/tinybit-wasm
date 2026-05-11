export function snapRgba8(channel: number): number {
    return channel & 0xF0;
}

export function snapAllChannels(rgba: number): number {
    return rgba & 0xF0F0F0F0;
}

export function packRgba8(r: number, g: number, b: number, a: number): number {
    return ((r & 0xFF) << 24 | (g & 0xFF) << 16 | (b & 0xFF) << 8 | (a & 0xFF)) >>> 0;
}

export function unpackRgba8(packed: number): { r: number; g: number; b: number; a: number } {
    return {
        r: (packed >>> 24) & 0xFF,
        g: (packed >>> 16) & 0xFF,
        b: (packed >>>  8) & 0xFF,
        a:  packed         & 0xFF,
    };
}

export function pack4444(r: number, g: number, b: number, a: number): number {
    return ((r >>> 4) << 12) | ((g >>> 4) << 8) | ((b >>> 4) << 4) | (a >>> 4);
}

export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
    const c = v * s;
    const hp = (h % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r1 = 0, g1 = 0, b1 = 0;
    if      (hp < 1) [r1,g1,b1] = [c, x, 0];
    else if (hp < 2) [r1,g1,b1] = [x, c, 0];
    else if (hp < 3) [r1,g1,b1] = [0, c, x];
    else if (hp < 4) [r1,g1,b1] = [0, x, c];
    else if (hp < 5) [r1,g1,b1] = [x, 0, c];
    else             [r1,g1,b1] = [c, 0, x];
    const m = v - c;
    return {
        r: Math.round((r1 + m) * 255),
        g: Math.round((g1 + m) * 255),
        b: Math.round((b1 + m) * 255),
    };
}

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
    const r1 = r / 255, g1 = g / 255, b1 = b / 255;
    const max = Math.max(r1, g1, b1), min = Math.min(r1, g1, b1);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if      (max === r1) h = 60 * (((g1 - b1) / d) % 6);
        else if (max === g1) h = 60 * ( (b1 - r1) / d + 2);
        else                 h = 60 * ( (r1 - g1) / d + 4);
    }
    if (h < 0) h += 360;
    const s = max === 0 ? 0 : d / max;
    return { h, s, v: max };
}

export function rgbaToHex(rgba: number): string {
    const u = unpackRgba8(rgba);
    const h = (n: number) => n.toString(16).padStart(2, '0');
    return `#${h(u.r)}${h(u.g)}${h(u.b)}${h(u.a)}`;
}

export function hexToRgba(hex: string): number | null {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
    if (!m) return null;
    const s = m[1];
    const r = parseInt(s.slice(0,2), 16);
    const g = parseInt(s.slice(2,4), 16);
    const b = parseInt(s.slice(4,6), 16);
    const a = s.length === 8 ? parseInt(s.slice(6,8), 16) : 0xFF;
    return packRgba8(r, g, b, a);
}

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR_OFFSET = 16;

export interface PngSize { width: number; height: number; }

export function readPngSize(bytes: Uint8Array): PngSize | null {
    if (bytes.length < IHDR_OFFSET + 8) return null;
    for (let i = 0; i < SIG.length; i++) if (bytes[i] !== SIG[i]) return null;
    if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(IHDR_OFFSET, false), height: dv.getUint32(IHDR_OFFSET + 4, false) };
}

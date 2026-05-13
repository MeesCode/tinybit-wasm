export interface PreviewExports {
    memory: WebAssembly.Memory;
    tb_preview_ptr(): number;
    tb_preview_cap(): number;
    tb_preview_music_play(len: number): number;
    tb_preview_sfx_play(len: number): number;
    tb_preview_stop(): void;
}

export class PreviewError extends Error {
    code: number;
    constructor(code: number, message: string) {
        super(message);
        this.code = code;
        this.name = 'PreviewError';
    }
}

export interface Preview {
    music(abc: string): void;
    sfx(abc: string): void;
    stop(): void;
}

function messageForCode(code: number): string {
    switch (code) {
        case -1: return 'engine rejected score: invalid ABC syntax';
        case -2: return 'engine rejected score: note pool exhausted';
        case -3: return 'score too large for preview buffer';
        case -4: return 'score is not valid UTF-8';
        default: return `engine returned ${code}`;
    }
}

function stage(ex: PreviewExports, abc: string): number {
    const bytes = new TextEncoder().encode(abc);
    const cap = ex.tb_preview_cap();
    if (bytes.length > cap) throw new PreviewError(-3, messageForCode(-3));
    const ptr = ex.tb_preview_ptr();
    new Uint8Array(ex.memory.buffer, ptr, bytes.length).set(bytes);
    return bytes.length;
}

export function makePreview(ex: PreviewExports): Preview {
    return {
        music(abc) {
            const len = stage(ex, abc);
            const rc = ex.tb_preview_music_play(len);
            if (rc !== 0) throw new PreviewError(rc, messageForCode(rc));
        },
        sfx(abc) {
            const len = stage(ex, abc);
            const rc = ex.tb_preview_sfx_play(len);
            if (rc !== 0) throw new PreviewError(rc, messageForCode(rc));
        },
        stop() { ex.tb_preview_stop(); },
    };
}

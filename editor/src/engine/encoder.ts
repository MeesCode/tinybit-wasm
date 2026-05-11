export const SLOT = {
    COVER:  0,
    SPRITE: 1,
    SCRIPT: 2,
    FRAME:  3,
    TITLE:  4,
    AUTHOR: 5,
} as const;

export interface EncoderExports {
    memory: WebAssembly.Memory;
    tb_enc_init(): number;
    tb_enc_input_ptr(slot: number): number;
    tb_enc_input_cap(slot: number): number;
    tb_enc_set_input_len(slot: number, len: number): void;
    tb_enc_set_header(gameVersion: number, flags: number, packageDate: number): number;
    tb_enc_run(): number;
    tb_enc_output_ptr(): number;
    tb_enc_error_ptr(): number;
    tb_enc_error_len(): number;
}

export interface EncodeInput {
    script: Uint8Array;
    sprite: Uint8Array;
    cover:  Uint8Array;
    title?:  string;
    author?: string;
    gameVersion?:  number;
    flags?:        number;
    packageDate?:  number;
    frameOverride?: Uint8Array;
}

export class EncodeError extends Error {
    code: number;
    constructor(code: number, message: string) {
        super(message);
        this.code = code;
        this.name = 'EncodeError';
    }
}

export interface Encoder {
    encode(input: EncodeInput): Uint8Array;
}

export function makeEncoder(ex: EncoderExports): Encoder {
    let initialized = false;

    function ensureInit() {
        if (!initialized) {
            if (ex.tb_enc_init() !== 1) throw new EncodeError(0, 'Encoder failed to initialize');
            initialized = true;
        }
    }

    function stage(slot: number, bytes: Uint8Array) {
        const cap = ex.tb_enc_input_cap(slot);
        if (bytes.length > cap) throw new EncodeError(0, `Input slot ${slot} exceeds capacity (${bytes.length} > ${cap})`);
        const ptr = ex.tb_enc_input_ptr(slot);
        new Uint8Array(ex.memory.buffer, ptr, bytes.length).set(bytes);
        ex.tb_enc_set_input_len(slot, bytes.length);
    }

    function stageString(slot: number, s: string, label: string) {
        const bytes = new TextEncoder().encode(s);
        if (bytes.length > 63) throw new EncodeError(0, `${label} is too long (max 63 UTF-8 bytes, got ${bytes.length})`);
        stage(slot, bytes);
    }

    function readErrorMessage(): string {
        const ptr = ex.tb_enc_error_ptr();
        const len = ex.tb_enc_error_len();
        if (len === 0) return 'unknown encoder error';
        const bytes = new Uint8Array(ex.memory.buffer, ptr, len);
        return new TextDecoder().decode(bytes);
    }

    return {
        encode(input) {
            ensureInit();
            stage(SLOT.COVER,  input.cover);
            stage(SLOT.SPRITE, input.sprite);
            stage(SLOT.SCRIPT, input.script);
            if (input.frameOverride) stage(SLOT.FRAME, input.frameOverride);
            else                     ex.tb_enc_set_input_len(SLOT.FRAME, 0);
            stageString(SLOT.TITLE,  input.title  ?? 'untitled', 'Title');
            stageString(SLOT.AUTHOR, input.author ?? '',         'Author');
            ex.tb_enc_set_header(
                input.gameVersion ?? 1,
                input.flags       ?? 0,
                input.packageDate ?? Math.floor(Date.now() / 1000),
            );
            const n = ex.tb_enc_run();
            if (n < 0) throw new EncodeError(n, readErrorMessage());
            const ptr = ex.tb_enc_output_ptr();
            return new Uint8Array(ex.memory.buffer, ptr, n).slice();
        },
    };
}

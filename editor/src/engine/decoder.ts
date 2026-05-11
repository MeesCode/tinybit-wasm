export interface DecoderExports {
    memory: WebAssembly.Memory;
    tb_dec_init(): number;
    tb_dec_input_ptr(): number;
    tb_dec_input_cap(): number;
    tb_dec_run(len: number): number;
    tb_dec_sprite_ptr(): number;
    tb_dec_sprite_len(): number;
    tb_dec_cover_ptr(): number;
    tb_dec_cover_len(): number;
    tb_dec_script_ptr(): number;
    tb_dec_script_len(): number;
    tb_dec_title_ptr(): number;
    tb_dec_title_len(): number;
    tb_dec_author_ptr(): number;
    tb_dec_author_len(): number;
    tb_dec_meta(): bigint;
    tb_dec_package_date(): number;
    tb_dec_error_ptr(): number;
    tb_dec_error_len(): number;
}

export interface DecodedCartridge {
    title:  string;
    author: string;
    sprite: Uint8Array;
    cover:  Uint8Array;
    script: string;
    formatVersion: number;
    gameVersion:   number;
    flags:         number;
    packageDate:   number;
    crcOk:         boolean;
}

export class DecodeError extends Error {
    code: number;
    constructor(code: number, message: string) {
        super(message);
        this.code = code;
        this.name = 'DecodeError';
    }
}

export interface Decoder {
    decode(cartridgePng: Uint8Array): DecodedCartridge;
}

export function makeDecoder(ex: DecoderExports): Decoder {
    let initialized = false;

    function ensureInit() {
        if (!initialized) {
            if (ex.tb_dec_init() !== 1) throw new DecodeError(0, 'Decoder failed to initialize');
            initialized = true;
        }
    }

    function readErrorMessage(): string {
        const ptr = ex.tb_dec_error_ptr();
        const len = ex.tb_dec_error_len();
        if (len === 0) return 'unknown decoder error';
        return new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ptr, len));
    }

    function readBytes(ptr: number, len: number): Uint8Array {
        return new Uint8Array(ex.memory.buffer, ptr, len).slice();
    }

    function readString(ptr: number, len: number): string {
        if (len === 0) return '';
        return new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ptr, len));
    }

    return {
        decode(cartridgePng) {
            ensureInit();
            const cap = ex.tb_dec_input_cap();
            if (cartridgePng.length > cap) {
                throw new DecodeError(0, `Cartridge too large: ${cartridgePng.length} > ${cap} bytes`);
            }
            const ptr = ex.tb_dec_input_ptr();
            new Uint8Array(ex.memory.buffer, ptr, cartridgePng.length).set(cartridgePng);

            const rc = ex.tb_dec_run(cartridgePng.length);
            if (rc !== 0) throw new DecodeError(rc, readErrorMessage());

            const sprite = readBytes(ex.tb_dec_sprite_ptr(), ex.tb_dec_sprite_len());
            const cover  = readBytes(ex.tb_dec_cover_ptr(),  ex.tb_dec_cover_len());
            const script = readString(ex.tb_dec_script_ptr(), ex.tb_dec_script_len());
            const title  = readString(ex.tb_dec_title_ptr(),  ex.tb_dec_title_len());
            const author = readString(ex.tb_dec_author_ptr(), ex.tb_dec_author_len());

            const meta = ex.tb_dec_meta();
            const formatVersion = Number(meta & 0xFFFFn);
            const flags         = Number((meta >> 16n) & 0xFFFFn);
            const gameVersion   = Number((meta >> 32n) & 0xFFFFn);
            const crcOk         = Number((meta >> 48n) & 0xFFn) === 1;
            const packageDate   = ex.tb_dec_package_date();

            return {
                title, author, sprite, cover, script,
                formatVersion, gameVersion, flags, packageDate, crcOk,
            };
        },
    };
}

import { makeWasiShim, type MemoryRef, type WasiSinks } from './wasiShim';
import { makeTinybit, type Tinybit, type TinybitExports } from './tinybit';
import { makeEncoder, type Encoder, type EncoderExports } from './encoder';
import { makeDecoder, type Decoder, type DecoderExports } from './decoder';
import { makeSpritesheet, type Spritesheet } from './spritesheet';
import { makePreview, type Preview, type PreviewExports } from './preview';

export interface Runtime {
    wasm: WebAssembly.Instance;
    memory: WebAssembly.Memory;
    tb: Tinybit;
    enc: Encoder;
    encoderAvailable: boolean;
    dec: Decoder;
    decoderAvailable: boolean;
    spritesheet: Spritesheet;
    preview: Preview;
    previewAvailable: boolean;
}

const WASM_URL = './tinybit_wasm.wasm';
let runtimePromise: Promise<Runtime> | null = null;

export function getRuntime(sinks: WasiSinks): Promise<Runtime> {
    if (!runtimePromise) runtimePromise = bootRuntime(sinks);
    return runtimePromise;
}

async function bootRuntime(sinks: WasiSinks): Promise<Runtime> {
    const memoryRef: MemoryRef = { value: null as unknown as WebAssembly.Memory };
    const shim = makeWasiShim(memoryRef, sinks);
    const wasm = await WebAssembly.instantiateStreaming(
        fetch(WASM_URL),
        { wasi_snapshot_preview1: shim },
    );
    const exports = wasm.instance.exports as unknown as
        TinybitExports & Partial<EncoderExports> & Partial<DecoderExports> & Partial<PreviewExports>;
    memoryRef.value = exports.memory;

    const tb = makeTinybit(exports);

    const spritesheet = makeSpritesheet({
        memory: exports.memory,
        ptr: () => (exports as TinybitExports).tb_spritesheet_ptr(),
        isRunning: () => false,
    });

    const encoderAvailable =
        typeof exports.tb_enc_init === 'function' &&
        typeof exports.tb_enc_run === 'function';
    const enc: Encoder = encoderAvailable
        ? makeEncoder(exports as unknown as EncoderExports)
        : { encode() { throw new Error('Encoder exports not present in WASM build — rebuild after merging feat/tb-encoder.'); } };

    const decoderAvailable =
        typeof exports.tb_dec_init === 'function' &&
        typeof exports.tb_dec_run === 'function';
    const dec: Decoder = decoderAvailable
        ? makeDecoder(exports as unknown as DecoderExports)
        : { decode() { throw new Error('Decoder exports not present in WASM build — rebuild after merging feat/tb-decoder.'); } };

    const { preview, previewAvailable } = __probePreview(exports);

    return {
        wasm: wasm.instance, memory: exports.memory, tb,
        enc, encoderAvailable, dec, decoderAvailable, spritesheet,
        preview, previewAvailable,
    };
}

export function __probePreview(exports: Partial<PreviewExports>): { preview: Preview; previewAvailable: boolean } {
    const previewAvailable =
        typeof exports.tb_preview_music_play === 'function' &&
        typeof exports.tb_preview_stop === 'function';
    const preview: Preview = previewAvailable
        ? makePreview(exports as PreviewExports)
        : {
            async music() { throw new Error('Preview exports not present in WASM build — rebuild after the score-editor branch lands.'); },
            async sfx()   { throw new Error('Preview exports not present in WASM build — rebuild after the score-editor branch lands.'); },
            stop()  {},
        };
    return { preview, previewAvailable };
}

export function resetRuntimeForTests(): void {
    runtimePromise = null;
}

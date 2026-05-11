import { makeWasiShim, type MemoryRef, type WasiSinks } from './wasiShim';
import { makeTinybit, type Tinybit, type TinybitExports } from './tinybit';
import { makeEncoder, type Encoder, type EncoderExports } from './encoder';

export interface Runtime {
    wasm: WebAssembly.Instance;
    memory: WebAssembly.Memory;
    tb: Tinybit;
    enc: Encoder;
    encoderAvailable: boolean;
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
    const exports = wasm.instance.exports as unknown as TinybitExports & Partial<EncoderExports>;
    memoryRef.value = exports.memory;

    const tb = makeTinybit(exports);
    const encoderAvailable =
        typeof exports.tb_enc_init === 'function' &&
        typeof exports.tb_enc_run === 'function';
    const enc: Encoder = encoderAvailable
        ? makeEncoder(exports as unknown as EncoderExports)
        : { encode() { throw new Error('Encoder exports not present in WASM build — rebuild after merging feat/tb-encoder.'); } };

    return { wasm: wasm.instance, memory: exports.memory, tb, enc, encoderAvailable };
}

export function resetRuntimeForTests(): void {
    runtimePromise = null;
}

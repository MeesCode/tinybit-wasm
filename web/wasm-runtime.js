import { makeWasiShim } from './wasi-shim.js';

const memoryRef = { value: null };
const wasi = makeWasiShim(memoryRef);

const wasmInstance = await WebAssembly.instantiateStreaming(
  fetch('./tinybit_wasm.wasm'),
  { wasi_snapshot_preview1: wasi },
);

export const tb = wasmInstance.instance.exports;
memoryRef.value = tb.memory;

export function wasmMemory() {
  return tb.memory;
}

// Re-export memoryRef for any consumer that needs to read after potential growth.
export { memoryRef };

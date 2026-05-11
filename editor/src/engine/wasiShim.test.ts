import { describe, test, expect, vi } from 'vitest';
import { makeWasiShim } from './wasiShim';

function makeMemory(bytes: Uint8Array): WebAssembly.Memory {
    const m = new WebAssembly.Memory({ initial: 1 });
    new Uint8Array(m.buffer).set(bytes);
    return m;
}

function writeIovec(memBytes: Uint8Array, iovsPtr: number, dataPtr: number, dataLen: number) {
    const dv = new DataView(memBytes.buffer);
    dv.setUint32(iovsPtr, dataPtr, true);
    dv.setUint32(iovsPtr + 4, dataLen, true);
}

describe('wasiShim', () => {
    test('fd_write to stdout flushes line-by-line into the stdout sink', () => {
        const data = new TextEncoder().encode('hello\nworld');
        const mem = new Uint8Array(65536);
        mem.set(data, 100);
        writeIovec(mem, 200, 100, data.length);
        const memory: WebAssembly.Memory = new WebAssembly.Memory({ initial: 1 });
        new Uint8Array(memory.buffer).set(mem);
        const stdout = vi.fn();
        const stderr = vi.fn();
        const shim = makeWasiShim({ value: memory }, { stdout, stderr });
        const nwritten = 240;
        const ret = shim.fd_write(1, 200, 1, nwritten);
        expect(ret).toBe(0);
        expect(stdout).toHaveBeenCalledWith('hello');
        expect(stderr).not.toHaveBeenCalled();
    });

    test('fd_write to stderr flushes lines into the stderr sink', () => {
        const data = new TextEncoder().encode('err1\n');
        const memory = makeMemory(new Uint8Array(0));
        new Uint8Array(memory.buffer).set(data, 100);
        const memBytes = new Uint8Array(memory.buffer);
        writeIovec(memBytes, 200, 100, data.length);
        const stderr = vi.fn();
        const shim = makeWasiShim({ value: memory }, { stdout: () => {}, stderr });
        shim.fd_write(2, 200, 1, 240);
        expect(stderr).toHaveBeenCalledWith('err1');
    });

    test('returns BADF for unknown fds', () => {
        const memory = new WebAssembly.Memory({ initial: 1 });
        const shim = makeWasiShim({ value: memory }, { stdout: () => {}, stderr: () => {} });
        expect(shim.fd_write(3, 0, 0, 0)).toBe(8);
    });

    test('proxy warns for unimplemented WASI fns and returns BADF', () => {
        const memory = new WebAssembly.Memory({ initial: 1 });
        const shim = makeWasiShim({ value: memory }, { stdout: () => {}, stderr: () => {} });
        // poll_oneoff is not defined → proxy fallthrough
        expect((shim as Record<string, (...a: number[]) => number>).poll_oneoff(0, 0, 0, 0)).toBe(8);
    });
});

export interface WasiSinks {
    stdout(line: string): void;
    stderr(line: string): void;
}

export interface MemoryRef { value: WebAssembly.Memory; }

export function makeWasiShim(memoryRef: MemoryRef, sinks: WasiSinks): Record<string, (...args: number[]) => number> {
    const dec = new TextDecoder();
    const dv = () => new DataView(memoryRef.value.buffer);
    const view = (ptr: number, len: number) => new Uint8Array(memoryRef.value.buffer, ptr, len);

    const ERRNO_SUCCESS = 0;
    const ERRNO_BADF = 8;

    let stdoutBuf = '';
    let stderrBuf = '';
    function flushLines(buf: string, fn: (line: string) => void): string {
        const lines = buf.split('\n');
        const tail = lines.pop() ?? '';
        for (const line of lines) fn(line);
        return tail;
    }

    const shim: Record<string, (...args: number[]) => number> = {
        fd_write(fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number): number {
            if (fd !== 1 && fd !== 2) return ERRNO_BADF;
            const parts: Uint8Array[] = [];
            let written = 0;
            for (let i = 0; i < iovsLen; i++) {
                const base = dv().getUint32(iovsPtr + i * 8, true);
                const len = dv().getUint32(iovsPtr + i * 8 + 4, true);
                parts.push(view(base, len).slice());
                written += len;
            }
            const total = parts.reduce((n, b) => n + b.length, 0);
            const merged = new Uint8Array(total);
            let off = 0;
            for (const b of parts) { merged.set(b, off); off += b.length; }
            const text = dec.decode(merged);
            if (fd === 1) stdoutBuf = flushLines(stdoutBuf + text, sinks.stdout);
            else          stderrBuf = flushLines(stderrBuf + text, sinks.stderr);
            dv().setUint32(nwrittenPtr, written, true);
            return ERRNO_SUCCESS;
        },
        fd_close: () => ERRNO_BADF,
        fd_seek: () => ERRNO_BADF,
        fd_read: () => ERRNO_BADF,
        fd_fdstat_get: () => ERRNO_BADF,
        fd_fdstat_set_flags: () => ERRNO_BADF,
        fd_prestat_get: () => ERRNO_BADF,
        fd_prestat_dir_name: () => ERRNO_BADF,
        fd_renumber: () => ERRNO_BADF,
        path_open: () => ERRNO_BADF,
        environ_get: () => ERRNO_SUCCESS,
        environ_sizes_get(countPtr: number, sizePtr: number): number {
            dv().setUint32(countPtr, 0, true);
            dv().setUint32(sizePtr, 0, true);
            return ERRNO_SUCCESS;
        },
        args_get: () => ERRNO_SUCCESS,
        args_sizes_get(countPtr: number, sizePtr: number): number {
            dv().setUint32(countPtr, 0, true);
            dv().setUint32(sizePtr, 0, true);
            return ERRNO_SUCCESS;
        },
        clock_time_get(_id: number, _precision: number, timePtr: number): number {
            const ns = BigInt(Math.floor(performance.now() * 1e6));
            new DataView(memoryRef.value.buffer).setBigUint64(timePtr, ns, true);
            return ERRNO_SUCCESS;
        },
        random_get(buf: number, len: number): number {
            crypto.getRandomValues(view(buf, len));
            return ERRNO_SUCCESS;
        },
        proc_exit(code: number): number {
            throw new Error(`proc_exit(${code})`);
        },
    };

    return new Proxy(shim, {
        get(target, name) {
            if (typeof name === 'string' && name in target) return target[name];
            return (...args: number[]) => {
                sinks.stderr(`unimplemented WASI fn: ${String(name)} ${JSON.stringify(args)}`);
                return ERRNO_BADF;
            };
        },
    }) as Record<string, (...args: number[]) => number>;
}

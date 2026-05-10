export function makeWasiShim(memoryRef) {
  const dec = new TextDecoder();
  const dv = () => new DataView(memoryRef.value.buffer);
  const view = (ptr, len) => new Uint8Array(memoryRef.value.buffer, ptr, len);

  const ERRNO_SUCCESS = 0;
  const ERRNO_BADF = 8;

  let stdoutBuf = '';
  let stderrBuf = '';
  function flushLines(buf, fn) {
    const lines = buf.split('\n');
    const tail = lines.pop();
    for (const line of lines) fn(line);
    return tail;
  }

  const shim = {
    fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
      if (fd !== 1 && fd !== 2) return ERRNO_BADF;
      const parts = [];
      let written = 0;
      for (let i = 0; i < iovsLen; i++) {
        const base = dv().getUint32(iovsPtr + i * 8, true);
        const len = dv().getUint32(iovsPtr + i * 8 + 4, true);
        parts.push(view(base, len));
        written += len;
      }
      const total = parts.reduce((n, b) => n + b.length, 0);
      const merged = new Uint8Array(total);
      let off = 0;
      for (const b of parts) { merged.set(b, off); off += b.length; }
      const text = dec.decode(merged);
      if (fd === 1) {
        stdoutBuf = flushLines(stdoutBuf + text, console.log);
      } else {
        stderrBuf = flushLines(stderrBuf + text, console.error);
      }
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
    environ_sizes_get(countPtr, sizePtr) {
      dv().setUint32(countPtr, 0, true);
      dv().setUint32(sizePtr, 0, true);
      return ERRNO_SUCCESS;
    },
    args_get: () => ERRNO_SUCCESS,
    args_sizes_get(countPtr, sizePtr) {
      dv().setUint32(countPtr, 0, true);
      dv().setUint32(sizePtr, 0, true);
      return ERRNO_SUCCESS;
    },
    clock_time_get(_id, _precision, timePtr) {
      const ns = BigInt(Math.floor(performance.now() * 1e6));
      dv().setBigUint64(timePtr, ns, true);
      return ERRNO_SUCCESS;
    },
    random_get(buf, len) {
      crypto.getRandomValues(view(buf, len));
      return ERRNO_SUCCESS;
    },
    proc_exit(code) {
      throw new Error(`proc_exit(${code})`);
    },
  };

  return new Proxy(shim, {
    get(target, name) {
      if (name in target) return target[name];
      return (...args) => {
        console.warn(`unimplemented WASI fn: ${String(name)}`, args);
        return ERRNO_BADF;
      };
    },
  });
}

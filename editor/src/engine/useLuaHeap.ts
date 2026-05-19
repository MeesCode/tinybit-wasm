import { useEffect, useState } from 'react';
import type { Runtime } from './runtime';
import type { FrameLoopState } from './frameLoop';

export type LuaHeapReading =
    | { state: 'idle' }
    | { state: 'unavailable' }
    | { state: 'live'; used: number; cap: number };

const SAMPLE_INTERVAL_MS = 250;

const IDLE: LuaHeapReading = { state: 'idle' };
const UNAVAILABLE: LuaHeapReading = { state: 'unavailable' };

export function useLuaHeap(runtime: Runtime | null, engineState: FrameLoopState): LuaHeapReading {
    const [reading, setReading] = useState<LuaHeapReading>(IDLE);

    useEffect(() => {
        if (!runtime || engineState !== 'running') {
            setReading(IDLE);
            return;
        }
        const used = runtime.tb.luaMemUsed;
        const cap  = runtime.tb.luaMemCapacity;
        if (typeof used !== 'function' || typeof cap !== 'function') {
            setReading(UNAVAILABLE);
            return;
        }
        const cachedCap = cap();
        const sample = () => setReading({ state: 'live', used: used(), cap: cachedCap });
        sample();
        const id = setInterval(sample, SAMPLE_INTERVAL_MS);
        return () => clearInterval(id);
    }, [runtime, engineState]);

    return reading;
}

import type { Tinybit } from './tinybit';
import { attachAudioWorklet } from './audioWorklet';
import { parseLuaError, type LuaError } from './luaError';

const SCREEN_W = 128;
const SCREEN_H = 128;
const AUDIO_FRAME_SAMPLES = 367;
const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_RAF = 2;
const MAX_DT_MS = STEP_MS * MAX_STEPS_PER_RAF;

export type FrameLoopState = 'idle' | 'running' | 'error';

export interface FrameLoop {
    start(canvas: HTMLCanvasElement): Promise<void>;
    stop(): void;
    state(): FrameLoopState;
    onStateChange(cb: (s: FrameLoopState) => void): () => void;
    onError(cb: (msg: string) => void): () => void;
    onLuaError(cb: (err: LuaError) => void): () => void;
}

export function makeFrameLoop(tb: Tinybit): FrameLoop {
    let raf = 0;
    let state: FrameLoopState = 'idle';
    let ctx: CanvasRenderingContext2D | null = null;
    let imageData: ImageData | null = null;
    let audioCtx: AudioContext | null = null;
    let workletNode: AudioWorkletNode | null = null;
    let lastTickMs = 0;
    let accumulatorMs = 0;
    const stateCbs = new Set<(s: FrameLoopState) => void>();
    const errCbs = new Set<(m: string) => void>();
    const luaErrCbs = new Set<(e: LuaError) => void>();
    const setState = (s: FrameLoopState) => { state = s; stateCbs.forEach((cb) => cb(s)); };

    function blit(canvas: HTMLCanvasElement) {
        if (!ctx || !imageData) return;
        const display = tb.displayView();
        const out = imageData.data;
        for (let i = 0; i < display.length; i++) {
            const px = display[i];
            out[i * 4]     = px & 0xf0;
            out[i * 4 + 1] = (px & 0x0f) << 4;
            out[i * 4 + 2] = (px >> 8) & 0xf0;
            out[i * 4 + 3] = ((px >> 8) & 0x0f) << 4;
        }
        ctx.putImageData(imageData, 0, 0);
        void canvas;
    }

    function pumpAudio() {
        if (!workletNode) return;
        const samples = tb.audioView();
        const f = new Float32Array(AUDIO_FRAME_SAMPLES);
        for (let i = 0; i < AUDIO_FRAME_SAMPLES; i++) f[i] = samples[i] / 32768;
        workletNode.port.postMessage(f.buffer, [f.buffer]);
    }

    function tick(canvas: HTMLCanvasElement, now: number) {
        if (state !== 'running') return;
        const dt = Math.min(now - lastTickMs, MAX_DT_MS);
        lastTickMs = now;
        accumulatorMs += dt;
        try {
            let steps = 0;
            while (accumulatorMs >= STEP_MS && steps < MAX_STEPS_PER_RAF) {
                tb.loopOnce();
                const raw = tb.takeLuaError();
                if (raw) {
                    const parsed = parseLuaError(raw.message, raw.traceback);
                    luaErrCbs.forEach((cb) => cb(parsed));
                }
                pumpAudio();
                accumulatorMs -= STEP_MS;
                steps++;
            }
            if (accumulatorMs > STEP_MS) accumulatorMs = STEP_MS;
            if (steps > 0) blit(canvas);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errCbs.forEach((cb) => cb(msg));
            setState('error');
            return;
        }
        raf = requestAnimationFrame((t) => tick(canvas, t));
    }

    return {
        async start(canvas) {
            ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('2d context unavailable');
            imageData = ctx.createImageData(SCREEN_W, SCREEN_H);
            if (!audioCtx) {
                try {
                    audioCtx = new AudioContext({ sampleRate: 22000 });
                    workletNode = await attachAudioWorklet(audioCtx);
                    workletNode.connect(audioCtx.destination);
                } catch {
                    audioCtx = null;
                    workletNode = null;
                }
            }
            setState('running');
            lastTickMs = performance.now();
            accumulatorMs = 0;
            raf = requestAnimationFrame((t) => tick(canvas, t));
        },
        stop() {
            if (raf) cancelAnimationFrame(raf);
            raf = 0;
            setState('idle');
        },
        state: () => state,
        onStateChange(cb) { stateCbs.add(cb); return () => stateCbs.delete(cb); },
        onError(cb)       { errCbs.add(cb);   return () => errCbs.delete(cb); },
        onLuaError(cb)    { luaErrCbs.add(cb); return () => luaErrCbs.delete(cb); },
    };
}

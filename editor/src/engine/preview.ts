import { attachAudioWorklet } from './audioWorklet';

const AUDIO_FRAME_SAMPLES = 367;
const AUDIO_SAMPLE_RATE = 22_000;

export interface PreviewExports {
    memory: WebAssembly.Memory;
    tb_preview_ptr(): number;
    tb_preview_cap(): number;
    tb_preview_music_play(len: number): number;
    tb_preview_sfx_play(len: number): number;
    tb_preview_stop(): void;
    tb_preview_tick(): void;
    tb_audio_ptr(): number;
}

export class PreviewError extends Error {
    code: number;
    constructor(code: number, message: string) {
        super(message);
        this.code = code;
        this.name = 'PreviewError';
    }
}

export interface Preview {
    music(abc: string): Promise<void>;
    sfx(abc: string): Promise<void>;
    stop(): void;
}

function messageForCode(code: number): string {
    switch (code) {
        case -1: return 'engine rejected score: invalid ABC syntax';
        case -2: return 'engine rejected score: note pool exhausted';
        case -3: return 'score too large for preview buffer';
        case -4: return 'score is not valid UTF-8';
        default: return `engine returned ${code}`;
    }
}

function stage(ex: PreviewExports, abc: string): number {
    const bytes = new TextEncoder().encode(abc);
    const cap = ex.tb_preview_cap();
    if (bytes.length > cap) throw new PreviewError(-3, messageForCode(-3));
    const ptr = ex.tb_preview_ptr();
    new Uint8Array(ex.memory.buffer, ptr, bytes.length).set(bytes);
    return bytes.length;
}

// Trims leading/trailing whitespace before handing the ABC to the engine.
// The score template body intentionally has leading + trailing newlines so the
// Lua [[...]] literal renders prettily, but the ABC parser rejects scores that
// start with whitespace.
function normalizeAbc(abc: string): string {
    return abc.replace(/^\s+/, '').replace(/\s+$/, '');
}

// Drives audio sample generation independently of the game's FrameLoop, so the
// Score tab can audition a score without a cartridge loaded or running. Owns a
// dedicated AudioContext + AudioWorkletNode + rAF tick loop.
interface PreviewPump {
    raf: number;
    ctx: AudioContext | null;
    worklet: AudioWorkletNode | null;
    running: boolean;
    attaching: Promise<void> | null;
}

function makePump(): PreviewPump {
    return { raf: 0, ctx: null, worklet: null, running: false, attaching: null };
}

async function ensureAttached(pump: PreviewPump): Promise<void> {
    if (pump.ctx && pump.worklet) return;
    if (pump.attaching) return pump.attaching;
    if (typeof AudioContext === 'undefined') return;  // test environment
    pump.attaching = (async () => {
        try {
            const ctx = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
            const worklet = await attachAudioWorklet(ctx);
            worklet.connect(ctx.destination);
            pump.ctx = ctx;
            pump.worklet = worklet;
        } catch {
            // Audio unavailable — preview will be silent but won't throw.
        } finally {
            pump.attaching = null;
        }
    })();
    return pump.attaching;
}

function startPump(ex: PreviewExports, pump: PreviewPump): void {
    if (pump.running) return;
    if (typeof requestAnimationFrame !== 'function') return;  // test environment
    pump.running = true;
    const tick = () => {
        if (!pump.running) return;
        try {
            ex.tb_preview_tick();
            if (pump.worklet) {
                const samples = new Int16Array(ex.memory.buffer, ex.tb_audio_ptr(), AUDIO_FRAME_SAMPLES);
                const f = new Float32Array(AUDIO_FRAME_SAMPLES);
                for (let i = 0; i < AUDIO_FRAME_SAMPLES; i++) f[i] = samples[i] / 32768;
                pump.worklet.port.postMessage(f.buffer, [f.buffer]);
            }
        } catch {
            pump.running = false;
            return;
        }
        pump.raf = requestAnimationFrame(tick);
    };
    pump.raf = requestAnimationFrame(tick);
}

function stopPump(pump: PreviewPump): void {
    if (pump.raf) cancelAnimationFrame(pump.raf);
    pump.raf = 0;
    pump.running = false;
}

export function makePreview(ex: PreviewExports): Preview {
    const pump = makePump();

    async function play(abc: string, playFn: (len: number) => number): Promise<void> {
        const normalized = normalizeAbc(abc);
        if (normalized.length === 0) throw new PreviewError(-1, messageForCode(-1));
        await ensureAttached(pump);
        // Resume the context on user gesture (browsers suspend it until then).
        if (pump.ctx && pump.ctx.state === 'suspended') await pump.ctx.resume();
        const len = stage(ex, normalized);
        const rc = playFn(len);
        if (rc !== 0) throw new PreviewError(rc, messageForCode(rc));
        startPump(ex, pump);
    }

    return {
        music(abc) { return play(abc, (len) => ex.tb_preview_music_play(len)); },
        sfx(abc)   { return play(abc, (len) => ex.tb_preview_sfx_play(len)); },
        stop() {
            ex.tb_preview_stop();
            stopPump(pump);
        },
    };
}

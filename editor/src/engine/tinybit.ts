const FEED_CHUNK = 256;
const SCREEN_PIXELS = 128 * 128;
const AUDIO_FRAME_SAMPLES = 367;

export interface TinybitExports {
    memory: WebAssembly.Memory;
    tb_init(): void;
    tb_start(): number;
    tb_stop(): void;
    tb_loop_once(): void;
    tb_set_button(idx: number, pressed: number): void;
    tb_feed_buffer_ptr(): number;
    tb_feed_cartridge(len: number): number;
    tb_display_ptr(): number;
    tb_audio_ptr(): number;
}

export interface Tinybit {
    init(): void;
    feedCartridge(bytes: Uint8Array): void;
    start(): void;
    stop(): void;
    loopOnce(): void;
    setButton(idx: number, pressed: boolean): void;
    displayView(): Uint16Array;
    audioView(): Int16Array;
}

export function makeTinybit(ex: TinybitExports): Tinybit {
    return {
        init: () => ex.tb_init(),
        feedCartridge(bytes) {
            const feedPtr = ex.tb_feed_buffer_ptr();
            for (let i = 0; i < bytes.length; i += FEED_CHUNK) {
                const end = Math.min(i + FEED_CHUNK, bytes.length);
                const chunk = bytes.subarray(i, end);
                new Uint8Array(ex.memory.buffer, feedPtr, chunk.length).set(chunk);
                if (ex.tb_feed_cartridge(chunk.length) === 0) {
                    throw new Error(`Cartridge rejected at offset ${i}`);
                }
            }
        },
        start() {
            if (ex.tb_start() === 0) throw new Error('Engine failed to start');
        },
        stop: () => ex.tb_stop(),
        loopOnce: () => ex.tb_loop_once(),
        setButton: (idx, pressed) => ex.tb_set_button(idx, pressed ? 1 : 0),
        displayView: () => new Uint16Array(ex.memory.buffer, ex.tb_display_ptr(), SCREEN_PIXELS),
        audioView:   () => new Int16Array(ex.memory.buffer, ex.tb_audio_ptr(), AUDIO_FRAME_SAMPLES),
    };
}

export const BUTTONS: Record<string, number> = {
    'a': 0, 'A': 0,
    'b': 1, 'B': 1,
    'ArrowUp': 2, 'ArrowDown': 3, 'ArrowLeft': 4, 'ArrowRight': 5,
    'Enter': 6, 'Backspace': 7,
};

export const PREVENT_DEFAULT_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace']);

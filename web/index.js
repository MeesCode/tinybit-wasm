import { makeWasiShim } from './wasi-shim.js';

const SCREEN_W = 128;
const SCREEN_H = 128;
const FEED_CHUNK = 256;
const BUTTONS = {
  'a': 0, 'A': 0,
  'b': 1, 'B': 1,
  'ArrowUp': 2, 'ArrowDown': 3, 'ArrowLeft': 4, 'ArrowRight': 5,
  'Enter': 6, 'Backspace': 7,
};
const PREVENT_DEFAULT_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace',
]);

const AUDIO_FRAME_SAMPLES = 367;

let audioCtx = null;
let workletNode = null;

async function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext({ sampleRate: 22000 });
  if (audioCtx.sampleRate !== 22000) {
    console.warn(
      `AudioContext refused 22000 Hz (got ${audioCtx.sampleRate} Hz); audio pitch may be off`,
    );
  }
  await audioCtx.audioWorklet.addModule('./audio-worklet.js');
  workletNode = new AudioWorkletNode(audioCtx, 'tinybit', { numberOfOutputs: 1, outputChannelCount: [1] });
  workletNode.connect(audioCtx.destination);
}

function pumpAudio() {
  if (!workletNode) return;
  const ptr = tb.tb_audio_ptr();
  const samples = new Int16Array(memoryRef.value.buffer, ptr, AUDIO_FRAME_SAMPLES);
  const f = new Float32Array(AUDIO_FRAME_SAMPLES);
  for (let i = 0; i < AUDIO_FRAME_SAMPLES; i++) {
    f[i] = samples[i] / 32768;
  }
  workletNode.port.postMessage(f.buffer, [f.buffer]);
}

const memoryRef = { value: null };
const wasi = makeWasiShim(memoryRef);

const wasm = await WebAssembly.instantiateStreaming(
  fetch('./tinybit_wasm.wasm'),
  { wasi_snapshot_preview1: wasi },
);
const tb = wasm.instance.exports;
memoryRef.value = tb.memory;

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const imageData = ctx.createImageData(SCREEN_W, SCREEN_H);
const errEl = document.getElementById('err');

let rafId = 0;
let running = false;

function showError(msg) {
  errEl.textContent = msg;
  console.error(msg);
}

function clearError() {
  errEl.textContent = '';
}

function blitDisplay() {
  const ptr = tb.tb_display_ptr();
  const display = new Uint16Array(memoryRef.value.buffer, ptr, SCREEN_W * SCREEN_H);
  const out = imageData.data;
  for (let i = 0; i < display.length; i++) {
    const px = display[i];
    const r = px & 0xf0;
    const g = (px & 0x0f) << 4;
    const b = (px >> 8) & 0xf0;
    const a = ((px >> 8) & 0x0f) << 4;
    const di = i * 4;
    out[di + 0] = r;
    out[di + 1] = g;
    out[di + 2] = b;
    out[di + 3] = a;
  }
  ctx.putImageData(imageData, 0, 0);
}

function tick() {
  if (!running) return;
  tb.tb_loop_once();
  blitDisplay();
  pumpAudio();
  rafId = requestAnimationFrame(tick);
}

function stopGame() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  if (running) {
    tb.tb_stop();
    running = false;
  }
}

async function loadCartridge(file) {
  clearError();
  stopGame();

  try {
    await ensureAudio();
  } catch (err) {
    console.warn('audio init failed; running silent:', err);
  }

  const buf = new Uint8Array(await file.arrayBuffer());

  tb.tb_init();

  const feedPtr = tb.tb_feed_buffer_ptr();
  for (let i = 0; i < buf.length; i += FEED_CHUNK) {
    const end = Math.min(i + FEED_CHUNK, buf.length);
    const chunk = buf.subarray(i, end);
    const stagingView = new Uint8Array(memoryRef.value.buffer, feedPtr, chunk.length);
    stagingView.set(chunk);
    if (tb.tb_feed_cartridge(chunk.length) === 0) {
      showError(`Invalid cartridge (failed at offset ${i})`);
      return;
    }
  }

  if (tb.tb_start() === 0) {
    showError('Failed to start cartridge');
    return;
  }

  running = true;
  rafId = requestAnimationFrame(tick);
}

document.getElementById('cart').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    await loadCartridge(file);
  } catch (err) {
    showError(`Error loading cartridge: ${err.message}`);
  }
});

window.addEventListener('keydown', (e) => {
  const idx = BUTTONS[e.key];
  if (idx === undefined) return;
  if (PREVENT_DEFAULT_KEYS.has(e.key)) e.preventDefault();
  if (e.repeat) return;
  tb.tb_set_button(idx, 1);
});

window.addEventListener('keyup', (e) => {
  const idx = BUTTONS[e.key];
  if (idx === undefined) return;
  if (PREVENT_DEFAULT_KEYS.has(e.key)) e.preventDefault();
  tb.tb_set_button(idx, 0);
});

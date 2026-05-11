import { tb, memoryRef } from './wasm-runtime.js';

const SLOT = { COVER: 0, SPRITE: 1, SCRIPT: 2, FRAME: 3, TITLE: 4, AUTHOR: 5 };
export const SCRIPT_MAX = 32621;

let initDone = false;
function ensureInit() {
  if (initDone) return;
  if (tb.tb_enc_init() === 0) throw new Error('tb_enc_init returned 0');
  initDone = true;
}

async function stageFile(slot, inputEl) {
  const file = inputEl.files && inputEl.files[0];
  if (!file) throw new Error(`${inputEl.id}: no file selected`);
  await stageBytes(slot, new Uint8Array(await file.arrayBuffer()), inputEl.id);
}

function stageBytes(slot, bytes, label) {
  const cap = tb.tb_enc_input_cap(slot);
  if (bytes.length > cap) {
    throw new Error(`${label}: ${bytes.length} bytes exceeds slot capacity ${cap}`);
  }
  const ptr = tb.tb_enc_input_ptr(slot);
  new Uint8Array(memoryRef.value.buffer, ptr, bytes.length).set(bytes);
  if (tb.tb_enc_set_input_len(slot, bytes.length) === 0) {
    throw new Error(`${label}: tb_enc_set_input_len rejected length ${bytes.length}`);
  }
}

function stageString(slot, str, label) {
  const bytes = new TextEncoder().encode(str);
  stageBytes(slot, bytes, label);
}

function readErrorMessage() {
  const len = tb.tb_enc_error_len();
  if (len === 0) return 'unknown encoder error';
  const ptr = tb.tb_enc_error_ptr();
  return new TextDecoder().decode(new Uint8Array(memoryRef.value.buffer, ptr, len));
}

export async function encodeFromForm(els) {
  ensureInit();

  await stageFile(SLOT.COVER,  els.cover);
  await stageFile(SLOT.SPRITE, els.sprite);
  await stageFile(SLOT.SCRIPT, els.script);
  if (els.frame.files && els.frame.files[0]) {
    await stageFile(SLOT.FRAME, els.frame);
  } else {
    tb.tb_enc_set_input_len(SLOT.FRAME, 0);
  }

  stageString(SLOT.TITLE,  els.title.value  || 'untitled', 'title');
  stageString(SLOT.AUTHOR, els.author.value || '',         'author');

  const gameVersion = parseInt(els.gameVersion.value, 10);
  const flagsStr = (els.flags.value || '0x0000').replace(/^0x/i, '');
  const flags = parseInt(flagsStr, 16);
  if (Number.isNaN(gameVersion) || gameVersion < 0 || gameVersion > 65535) {
    throw new Error('game version must be an integer 0..65535');
  }
  if (Number.isNaN(flags) || flags < 0 || flags > 0xFFFF) {
    throw new Error('flags must be a 16-bit hex value (e.g. 0x0000)');
  }

  tb.tb_enc_set_header(gameVersion, flags, Math.floor(Date.now() / 1000));

  const n = tb.tb_enc_run();
  if (n < 0) throw new Error(readErrorMessage());

  const ptr = tb.tb_enc_output_ptr();
  return new Uint8Array(memoryRef.value.buffer, ptr, n).slice();
}

export function sanitizeFilename(title) {
  const cleaned = (title || '').replace(/[^A-Za-z0-9._-]/g, '_');
  return (cleaned || 'cartridge') + '.tb.png';
}

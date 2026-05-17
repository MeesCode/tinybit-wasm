// Cartridge-format constants surfaced to UI code.
// Mirrors src/encoder/mod.rs::SCRIPT_MAX and tinybit.h::TB_MEM_LUA_STATE_SIZE.

export const SCRIPT_MAX = 32_621;        // bytes; reserves 1 byte for trailing NUL
export const LUA_HEAP_CAPACITY = 262_144; // bytes; matches TB_MEM_LUA_STATE_SIZE

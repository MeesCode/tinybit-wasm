import { describe, it, expect } from 'vitest';
import { parseLuaError, formatLuaError } from './luaError';

describe('parseLuaError', () => {
    it('extracts line and stripped message from well-formed prefix', () => {
        const err = parseLuaError('script:23: attempt to index a nil value (global \'foo\')', null);
        expect(err.line).toBe(23);
        expect(err.message).toBe('attempt to index a nil value (global \'foo\')');
        expect(err.rawMessage).toBe('script:23: attempt to index a nil value (global \'foo\')');
        expect(err.traceback).toBeNull();
    });

    it('keeps raw message when prefix is missing', () => {
        const err = parseLuaError('(non-string error)', null);
        expect(err.line).toBeNull();
        expect(err.message).toBe('(non-string error)');
        expect(err.rawMessage).toBe('(non-string error)');
    });

    it('preserves traceback verbatim', () => {
        const tb = 'stack traceback:\n\tscript:23: in function \'_draw\'\n\t[C]: in ?';
        const err = parseLuaError('script:23: boom', tb);
        expect(err.traceback).toBe(tb);
    });
});

describe('formatLuaError', () => {
    it('uses "at line N" when line is known', () => {
        const out = formatLuaError({
            line: 23, message: 'boom', rawMessage: 'script:23: boom', traceback: null,
        });
        expect(out).toBe('Lua error at line 23: boom');
    });

    it('omits "at line N" when line is unknown', () => {
        const out = formatLuaError({
            line: null, message: 'mystery', rawMessage: 'mystery', traceback: null,
        });
        expect(out).toBe('Lua error: mystery');
    });

    it('indents the traceback under the headline', () => {
        const out = formatLuaError({
            line: 23, message: 'boom', rawMessage: 'script:23: boom',
            traceback: 'stack traceback:\n\tscript:23: in function \'_draw\'',
        });
        expect(out).toBe(
            'Lua error at line 23: boom\n' +
            '  stack traceback:\n' +
            '    script:23: in function \'_draw\'',
        );
    });
});

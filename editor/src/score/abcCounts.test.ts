import { describe, expect, it } from 'vitest';
import { countAbc, noteStatus, voiceStatus, MUSIC_MAX_NOTES, MAX_VOICES, SFX_MAX_NOTES, notesCap } from './abcCounts';

describe('countAbc — notes', () => {
    it('counts single-voice notes', () => {
        expect(countAbc('K:C\nCDEF').notes).toBe(4);
        expect(countAbc('K:C\nC D E F G A B c').notes).toBe(8);
    });

    it('counts notes with accidentals and durations as one each', () => {
        expect(countAbc('K:C\n^C2 _D/2 =E G3/4').notes).toBe(4);
    });

    it('counts chord brackets as one note', () => {
        expect(countAbc('K:C\n[CEG] [DFA] [EGc]').notes).toBe(3);
    });

    it('counts rests', () => {
        expect(countAbc('K:C\nC z D z').notes).toBe(4);
    });

    it('skips info-field headers', () => {
        expect(countAbc('X:1\nT:Test\nM:4/4\nL:1/8\nQ:1/4=120\nK:Cmaj\nCDEF').notes).toBe(4);
    });

    it('skips line comments', () => {
        expect(countAbc('K:C\nC D % this is a comment\nE F').notes).toBe(4);
    });

    it('skips bar lines, slurs, and tuplet markers', () => {
        expect(countAbc('K:C\n|: C D E F :| (3GAB c').notes).toBe(8);
    });
});

describe('countAbc — voices', () => {
    it('reports 1 voice when no V: headers are present', () => {
        expect(countAbc('K:C\nCDEF').voices).toBe(1);
    });

    it('counts two V: header voices', () => {
        const abc = 'L:1/8\nK:C\nV:MELODY\nCDEF GABc\nV:BASS\nC,4 G,4';
        expect(countAbc(abc).voices).toBe(2);
    });

    it('counts three voices', () => {
        const abc = 'K:C\nV:A\nCDEF\nV:B\nCDEF\nV:C\nCDEF';
        expect(countAbc(abc).voices).toBe(3);
    });

    it('reports max notes across voices (not sum)', () => {
        // Voice A: 4 notes. Voice B: 8 notes.
        const abc = 'K:C\nV:A\nCDEF\nV:B\nCDEFGABc';
        expect(countAbc(abc).notes).toBe(8);
    });
});

describe('status thresholds', () => {
    it('noteStatus is ok well under capacity', () => {
        expect(noteStatus(0, 'music')).toBe('ok');
        expect(noteStatus(Math.floor(MUSIC_MAX_NOTES * 0.5), 'music')).toBe('ok');
    });
    it('noteStatus is warn at >=90% of capacity', () => {
        expect(noteStatus(Math.floor(MUSIC_MAX_NOTES * 0.9), 'music')).toBe('warn');
        expect(noteStatus(MUSIC_MAX_NOTES, 'music')).toBe('warn');
    });
    it('noteStatus is over above capacity', () => {
        expect(noteStatus(MUSIC_MAX_NOTES + 1, 'music')).toBe('over');
    });

    it('voiceStatus is ok at 1', () => {
        expect(voiceStatus(1)).toBe('ok');
    });
    it('voiceStatus is warn at max-1 and at max', () => {
        expect(voiceStatus(MAX_VOICES - 1)).toBe('warn');
        expect(voiceStatus(MAX_VOICES)).toBe('warn');
    });
    it('voiceStatus is over above max', () => {
        expect(voiceStatus(MAX_VOICES + 1)).toBe('over');
    });
});

describe('per-kind note caps', () => {
    it('exposes SFX_MAX_NOTES = 10 (engine limit from audio.c)', () => {
        expect(SFX_MAX_NOTES).toBe(10);
    });
    it('notesCap returns 400 for music, 10 for sfx', () => {
        expect(notesCap('music')).toBe(400);
        expect(notesCap('sfx')).toBe(10);
    });
    it('noteStatus uses the kind-specific cap', () => {
        expect(noteStatus(11, 'sfx')).toBe('over');
        expect(noteStatus(9,  'sfx')).toBe('warn'); // >=90% of 10 → 9
        expect(noteStatus(8,  'sfx')).toBe('ok');
        expect(noteStatus(11, 'music')).toBe('ok');
        expect(noteStatus(400, 'music')).toBe('warn');    // 400 == cap → warn, not over
        expect(noteStatus(401, 'music')).toBe('over');
    });
});

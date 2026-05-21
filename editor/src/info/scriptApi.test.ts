import { describe, expect, it } from 'vitest';
import { SCRIPT_API_SECTIONS, type ApiSection } from './scriptApi';

describe('SCRIPT_API_SECTIONS data', () => {
    it('has a non-empty list of sections', () => {
        expect(SCRIPT_API_SECTIONS.length).toBeGreaterThan(0);
    });

    it('every section is non-empty and has a title', () => {
        for (const s of SCRIPT_API_SECTIONS) {
            expect(s.title.length).toBeGreaterThan(0);
            expect(s.items.length).toBeGreaterThan(0);
        }
    });

    it('every entry has name, signature, and description', () => {
        for (const s of SCRIPT_API_SECTIONS) {
            for (const e of s.items) {
                expect(e.name.length).toBeGreaterThan(0);
                expect(e.signature.length).toBeGreaterThan(0);
                expect(e.description.length).toBeGreaterThan(0);
            }
        }
    });

    it('has no duplicate entry names within any section', () => {
        for (const s of SCRIPT_API_SECTIONS) {
            const names = s.items.map((e) => e.name);
            expect(new Set(names).size).toBe(names.length);
        }
    });

    it('includes the --@music and --@sfx annotations in an Annotations section', () => {
        const section = SCRIPT_API_SECTIONS.find((s: ApiSection) => s.title === 'Annotations');
        expect(section).toBeDefined();
        expect(section!.items.some((e) => e.name === '--@music')).toBe(true);
        expect(section!.items.some((e) => e.name === '--@sfx')).toBe(true);
    });

    it('includes the _draw hook in a Hooks section', () => {
        const section = SCRIPT_API_SECTIONS.find((s: ApiSection) => s.title === 'Hooks');
        expect(section).toBeDefined();
        expect(section!.items.some((e) => e.name === '_draw')).toBe(true);
    });

    it('includes the music() audio function', () => {
        const audio = SCRIPT_API_SECTIONS.find((s) => s.title === 'Audio');
        expect(audio).toBeDefined();
        expect(audio!.items.some((e) => e.name === 'music')).toBe(true);
    });
});

describe('SCRIPT_API_SECTIONS — jargon-free copy', () => {
    const BANNED = ['blit', 'RGBA4444', 'Pack 8-bit'];

    it('no description, tip, or param contains banned jargon', () => {
        for (const s of SCRIPT_API_SECTIONS) {
            for (const e of s.items) {
                const fields = [
                    e.description,
                    e.tip ?? '',
                    ...(e.params ?? []).map((p) => p.description),
                ];
                for (const field of fields) {
                    for (const term of BANNED) {
                        expect(field.toLowerCase()).not.toContain(term.toLowerCase());
                    }
                }
            }
        }
    });
});

describe('SCRIPT_API_SECTIONS — params shape', () => {
    it('every params array, when present, is non-empty and well-formed', () => {
        for (const s of SCRIPT_API_SECTIONS) {
            for (const e of s.items) {
                if (e.params === undefined) continue;
                expect(e.params.length).toBeGreaterThan(0);
                for (const p of e.params) {
                    expect(p.name.length).toBeGreaterThan(0);
                    expect(p.description.length).toBeGreaterThan(0);
                }
            }
        }
    });
});

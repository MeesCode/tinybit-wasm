import { describe, expect, it } from 'vitest';
import { ABC_SECTIONS } from './abcInfo';

describe('ABC_SECTIONS data', () => {
    it('has a non-empty list of sections', () => {
        expect(ABC_SECTIONS.length).toBeGreaterThan(0);
    });

    it('every section is non-empty and has a title', () => {
        for (const s of ABC_SECTIONS) {
            expect(s.title.length).toBeGreaterThan(0);
            expect(s.body.length).toBeGreaterThan(0);
        }
    });

    it('every entry has non-empty text', () => {
        for (const s of ABC_SECTIONS) {
            for (const e of s.body) {
                expect(e.text.length).toBeGreaterThan(0);
            }
        }
    });

    it('every entry with an abc field has at least 4 characters of content', () => {
        for (const s of ABC_SECTIONS) {
            for (const e of s.body) {
                if (e.abc !== undefined) {
                    expect(e.abc.length).toBeGreaterThanOrEqual(4);
                }
            }
        }
    });

    it('includes a Headers section and an Engine limits section', () => {
        const titles = ABC_SECTIONS.map((s) => s.title);
        expect(titles).toContain('Headers');
        expect(titles).toContain('Engine limits');
    });

    it('at least one section contains a rendered example (abc field)', () => {
        const anyAbc = ABC_SECTIONS.some((s) => s.body.some((e) => e.abc !== undefined));
        expect(anyAbc).toBe(true);
    });
});

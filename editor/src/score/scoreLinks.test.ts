import { describe, expect, it } from 'vitest';
import { findScores } from './scoreLinks';

describe('findScores — long-bracket form', () => {
    it('detects --@score followed by [[ ... ]]', () => {
        const script = [
            'local x = 1',
            '--@score',
            'local tune = [[',
            'L:1/4',
            'K:C',
            'C D E F',
            ']]',
            'music(tune)',
        ].join('\n');
        const { links, diagnostics } = findScores(script);
        expect(diagnostics).toEqual([]);
        expect(links).toHaveLength(1);
        const [link] = links;
        expect(link.id).toBe('anon:2');           // annotationLine is 1-based; --@score is line 2
        expect(link.name).toBeUndefined();
        expect(link.form).toEqual({ kind: 'long', level: 0 });
        // content trims neither leading nor trailing newline that abuts the bracket:
        expect(link.content).toBe('\nL:1/4\nK:C\nC D E F\n');
        // openerRange points at the `[[`
        expect(script.slice(link.openerRange.from, link.openerRange.to)).toBe('[[');
        // closerRange points at the `]]`
        expect(script.slice(link.closerRange.from, link.closerRange.to)).toBe(']]');
    });

    it('detects --@score: name and captures the name', () => {
        const script = `--@score: bass_line\nlocal bass = [[\nK:C\nC,4\n]]\n`;
        const { links } = findScores(script);
        expect(links).toHaveLength(1);
        expect(links[0].name).toBe('bass_line');
        expect(links[0].id).toBe('name:bass_line');
    });

    it('handles --@score:  name (with extra whitespace)', () => {
        const script = `--@score:   verse\nlocal v = [[K:C\nC\n]]\n`;
        const { links } = findScores(script);
        expect(links[0].name).toBe('verse');
    });

    it('handles --@score: (empty name) as unnamed', () => {
        const script = `--@score:   \nlocal v = [[K:C\nC\n]]\n`;
        const { links } = findScores(script);
        expect(links[0].name).toBeUndefined();
    });

    it('detects [==[ ... ]==] (one level of escalation)', () => {
        const script = `--@score\nlocal v = [==[\nL:1/4\n[[ literal in score ]] is fine\n]==]\n`;
        const { links } = findScores(script);
        expect(links).toHaveLength(1);
        expect(links[0].form).toEqual({ kind: 'long', level: 2 });
        expect(links[0].content).toBe('\nL:1/4\n[[ literal in score ]] is fine\n');
    });

    it('detects [===[ ... ]===] (two levels)', () => {
        const script = `--@score\nlocal v = [===[\nx\n]===]\n`;
        expect(findScores(script).links[0].form).toEqual({ kind: 'long', level: 3 });
    });

    it('skips blank lines between annotation and literal (within 3)', () => {
        const script = `--@score\n\n\nlocal v = [[\nK:C\nC\n]]\n`;
        expect(findScores(script).links).toHaveLength(1);
    });

    it('emits diagnostic when no literal within 3 non-blank lines', () => {
        const script = `--@score\nlocal a = 1\nlocal b = 2\nlocal c = 3\nlocal v = [[\nK:C\n]]\n`;
        const { links, diagnostics } = findScores(script);
        expect(links).toHaveLength(0);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatchObject({ kind: 'unbound-annotation', line: 1 });
    });
});

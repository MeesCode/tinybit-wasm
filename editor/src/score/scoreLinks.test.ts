import { describe, expect, it } from 'vitest';
import { findScores } from './scoreLinks';

describe('findScores — long-bracket form', () => {
    it('detects --@music followed by [[ ... ]]', () => {
        const script = [
            'local x = 1',
            '--@music',
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
        expect(link.id).toBe('music:anon:2');      // annotationLine is 1-based; --@music is line 2
        expect(link.name).toBeUndefined();
        expect(link.form).toEqual({ kind: 'long', level: 0 });
        // content trims neither leading nor trailing newline that abuts the bracket:
        expect(link.content).toBe('\nL:1/4\nK:C\nC D E F\n');
        // openerRange points at the `[[`
        expect(script.slice(link.openerRange.from, link.openerRange.to)).toBe('[[');
        // closerRange points at the `]]`
        expect(script.slice(link.closerRange.from, link.closerRange.to)).toBe(']]');
    });

    it('detects --@music: name and captures the name', () => {
        const script = `--@music: bass_line\nlocal bass = [[\nK:C\nC,4\n]]\n`;
        const { links } = findScores(script);
        expect(links).toHaveLength(1);
        expect(links[0].name).toBe('bass_line');
        expect(links[0].id).toBe('music:name:bass_line');
    });

    it('handles --@music:  name (with extra whitespace)', () => {
        const script = `--@music:   verse\nlocal v = [[K:C\nC\n]]\n`;
        const { links } = findScores(script);
        expect(links[0].name).toBe('verse');
    });

    it('handles --@music: (empty name) as unnamed', () => {
        const script = `--@music:   \nlocal v = [[K:C\nC\n]]\n`;
        const { links } = findScores(script);
        expect(links[0].name).toBeUndefined();
    });

    it('detects [==[ ... ]==] (one level of escalation)', () => {
        const script = `--@music\nlocal v = [==[\nL:1/4\n[[ literal in score ]] is fine\n]==]\n`;
        const { links } = findScores(script);
        expect(links).toHaveLength(1);
        expect(links[0].form).toEqual({ kind: 'long', level: 2 });
        expect(links[0].content).toBe('\nL:1/4\n[[ literal in score ]] is fine\n');
    });

    it('detects [===[ ... ]===] (two levels)', () => {
        const script = `--@music\nlocal v = [===[\nx\n]===]\n`;
        expect(findScores(script).links[0].form).toEqual({ kind: 'long', level: 3 });
    });

    it('skips blank lines between annotation and literal (within 3)', () => {
        const script = `--@music\n\n\nlocal v = [[\nK:C\nC\n]]\n`;
        expect(findScores(script).links).toHaveLength(1);
    });

    it('emits diagnostic when no literal within 3 non-blank lines', () => {
        const script = `--@music\nlocal a = 1\nlocal b = 2\nlocal c = 3\nlocal v = [[\nK:C\n]]\n`;
        const { links, diagnostics } = findScores(script);
        expect(links).toHaveLength(0);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatchObject({ kind: 'unbound-annotation', line: 1 });
    });
});

describe('findScores — quoted form', () => {
    it('detects --@music with "..." literal and decodes \\n', () => {
        const script = `--@music\nlocal v = "L:1/4\\nK:C\\nC4"\n`;
        const { links } = findScores(script);
        expect(links).toHaveLength(1);
        expect(links[0].form).toEqual({ kind: 'quoted', quote: '"' });
        expect(links[0].content).toBe('L:1/4\nK:C\nC4');
    });

    it("detects --@music with '...' literal", () => {
        const script = `--@music\nlocal v = 'c/4d/4'\n`;
        const { links } = findScores(script);
        expect(links[0].form).toEqual({ kind: 'quoted', quote: "'" });
        expect(links[0].content).toBe('c/4d/4');
    });
});

describe('findScores — robustness', () => {
    it('ignores --@music appearing inside a string literal', () => {
        const script = `local x = "--@music actually inside a string"\nlocal y = 1\n`;
        const { links, diagnostics } = findScores(script);
        expect(links).toEqual([]);
        expect(diagnostics).toEqual([]);
    });

    it('ignores --@music inside a long-bracket literal', () => {
        const script = `local x = [[\n--@music not an annotation\n]]\nlocal y = 1\n`;
        expect(findScores(script).links).toEqual([]);
    });

    it('ignores --@music inside a --[[ ... ]] block comment', () => {
        const script = `--[[ --@music not an annotation ]]\nlocal y = 1\n`;
        expect(findScores(script).links).toEqual([]);
    });

    it('produces a duplicate-name diagnostic when two scores share a name', () => {
        const script =
            `--@music: tune\nlocal a = [[K:C\nC\n]]\n` +
            `--@music: tune\nlocal b = [[K:C\nD\n]]\n`;
        const { links, diagnostics } = findScores(script);
        expect(links).toHaveLength(2);
        const dups = diagnostics.filter((d) => d.kind === 'duplicate-name');
        expect(dups).toHaveLength(1);
    });

    it('returns multiple links in script order', () => {
        const script =
            `--@music: first\nlocal a = [[K:C\nC\n]]\n` +
            `--@music: second\nlocal b = [[K:C\nD\n]]\n`;
        const { links } = findScores(script);
        expect(links.map((l) => l.name)).toEqual(['first', 'second']);
        expect(links[0].annotationLine).toBe(1);
        expect(links[1].annotationLine).toBe(5);
    });

    it('detects --@sfx followed by a literal and tags kind="sfx"', () => {
        const script = `--@sfx: jump\nlocal j = "c/4d/4e/4"\n`;
        const { links, diagnostics } = findScores(script);
        expect(diagnostics).toEqual([]);
        expect(links).toHaveLength(1);
        expect(links[0].kind).toBe('sfx');
        expect(links[0].name).toBe('jump');
        expect(links[0].id).toBe('sfx:name:jump');
    });

    it('tags --@music links with kind="music"', () => {
        const script = `--@music: tune\nlocal t = [[K:C\nC\n]]\n`;
        const { links } = findScores(script);
        expect(links[0].kind).toBe('music');
        expect(links[0].id).toBe('music:name:tune');
    });

    it('allows same name across kinds without a duplicate diagnostic', () => {
        const script =
            `--@music: bass\nlocal a = [[K:C\nC\n]]\n` +
            `--@sfx: bass\nlocal b = "c"\n`;
        const { links, diagnostics } = findScores(script);
        expect(diagnostics).toEqual([]);
        expect(links.map((l) => l.id).sort()).toEqual(['music:name:bass', 'sfx:name:bass']);
    });

    it('still flags duplicates within the same kind', () => {
        const script =
            `--@sfx: hit\nlocal a = "c"\n` +
            `--@sfx: hit\nlocal b = "d"\n`;
        const { diagnostics } = findScores(script);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatchObject({ kind: 'duplicate-name', name: 'hit' });
    });

    it('uses kind-prefixed anon ids when no name is given', () => {
        const script = `--@sfx\nlocal s = "c"\n`;
        const { links } = findScores(script);
        expect(links[0].id).toBe('sfx:anon:1');
    });
});

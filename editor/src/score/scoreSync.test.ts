import { describe, expect, it } from 'vitest';
import { findScores } from './scoreLinks';
import { replaceScoreContent, insertNewScoreSnippet } from './scoreSync';

function firstLink(script: string) {
    const { links } = findScores(script);
    if (links.length === 0) throw new Error('expected at least one link in fixture');
    return { link: links[0], script };
}

describe('replaceScoreContent — long-bracket form', () => {
    it('splices new content into [[...]] without changing the form', () => {
        const { link, script } = firstLink('--@music\nlocal v = [[\nold\n]]\n');
        const r = replaceScoreContent(script, link, '\nnew\n');
        if ('error' in r) throw new Error(`expected ok, got error ${r.error}`);
        expect(r.script).toBe('--@music\nlocal v = [[\nnew\n]]\n');
    });

    it('escalates [[ → [==[ when new content contains ]]', () => {
        const { link, script } = firstLink('--@music\nlocal v = [[\nx\n]]\n');
        const r = replaceScoreContent(script, link, '\nfoo ]] bar\n');
        if ('error' in r) throw new Error(`expected ok, got error ${r.error}`);
        expect(r.script).toBe('--@music\nlocal v = [==[\nfoo ]] bar\n]==]\n');
    });

    it('escalates [==[ → [===[ when new content contains ]==]', () => {
        const { link, script } = firstLink('--@music\nlocal v = [==[\nx\n]==]\n');
        const r = replaceScoreContent(script, link, '\nfoo ]==] bar\n');
        if ('error' in r) throw new Error(`expected ok, got error ${r.error}`);
        expect(r.script).toBe('--@music\nlocal v = [===[\nfoo ]==] bar\n]===]\n');
    });

    it('fails with bracket-escalation-exhausted past 3 levels', () => {
        const { link, script } = firstLink('--@music\nlocal v = [===[\nx\n]===]\n');
        const r = replaceScoreContent(script, link, 'a ]===] b ]====] c ]=====]');
        expect('error' in r && r.error).toBe('bracket-escalation-exhausted');
    });
});

describe('replaceScoreContent — quoted form', () => {
    it('re-escapes newlines and quotes for "..."', () => {
        const { link, script } = firstLink('--@music\nlocal v = "old"\n');
        const r = replaceScoreContent(script, link, 'L:1/4\nK:C\n"quoted"');
        if ('error' in r) throw new Error(`expected ok`);
        expect(r.script).toBe('--@music\nlocal v = "L:1/4\\nK:C\\n\\"quoted\\""\n');
    });

    it("re-escapes for '...'", () => {
        const { link, script } = firstLink("--@music\nlocal v = 'old'\n");
        const r = replaceScoreContent(script, link, "it's");
        if ('error' in r) throw new Error('expected ok');
        expect(r.script).toBe("--@music\nlocal v = 'it\\'s'\n");
    });
});

describe('replaceScoreContent — link staleness', () => {
    it('returns link-stale when annotation no longer exists at the stored offsets', () => {
        const initial = '--@music\nlocal v = [[\nx\n]]\n';
        const { link } = firstLink(initial);
        const mutated = '-- the annotation has been deleted\nlocal v = [[\nx\n]]\n';
        const r = replaceScoreContent(mutated, link, 'new');
        expect('error' in r && r.error).toBe('link-stale');
    });
});

describe('insertNewScoreSnippet', () => {
    it('inserts a starter snippet at the cursor and returns a valid link', () => {
        const initial = `function _draw() end\n`;
        const result = insertNewScoreSnippet(initial, initial.length, 'music');
        expect(result.script).toContain('--@music: music_1');
        expect(result.script).toContain('[[\nL:1/4\nK:C\nC D E F |\n]]');
        // Returned link points at the inserted score
        const verify = findScores(result.script);
        expect(verify.links.some((l) => l.name === 'music_1')).toBe(true);
        expect(result.newLink.name).toBe('music_1');
    });

    it('chooses an unused name when music_1 is taken', () => {
        const initial = `--@music: music_1\nlocal a = [[\nK:C\nC\n]]\n`;
        const result = insertNewScoreSnippet(initial, initial.length, 'music');
        expect(result.newLink.name).toBe('music_2');
    });

    it('prefixes a newline when cursor is mid-line', () => {
        const initial = 'do_thing()';
        const result = insertNewScoreSnippet(initial, initial.length, 'music');
        expect(result.script.startsWith('do_thing()\n')).toBe(true);
    });
});

describe('insertNewScoreSnippet (sfx kind)', () => {
    it('emits a --@sfx annotation with a quoted literal and an sfx_N name', () => {
        const { script: out, newLink } = insertNewScoreSnippet('', 0, 'sfx');
        expect(out).toContain('--@sfx: sfx_1');
        expect(out).toContain('local sfx_1 = "c/4d/4e/4"');
        expect(newLink.kind).toBe('sfx');
    });

    it('picks the next unused sfx_N when one already exists', () => {
        const start = `--@sfx: sfx_1\nlocal a = "c"\n`;
        const { script: out } = insertNewScoreSnippet(start, start.length, 'sfx');
        expect(out).toContain('--@sfx: sfx_2');
    });

    it('music and sfx name pools are independent', () => {
        // A music score named music_1 should not push the sfx counter past sfx_1.
        const start = `--@music: music_1\nlocal a = [[K:C\nC\n]]\n`;
        const { script: out } = insertNewScoreSnippet(start, start.length, 'sfx');
        expect(out).toContain('--@sfx: sfx_1');
    });
});

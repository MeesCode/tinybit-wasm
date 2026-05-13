import { findScores, type ScoreLink } from './scoreLinks';

export type ReplaceResult =
    | { script: string }
    | { error: 'link-stale' | 'bracket-escalation-exhausted' };

const MAX_BRACKET_LEVEL = 3;

export function replaceScoreContent(
    script: string,
    link: ScoreLink,
    newContent: string,
): ReplaceResult {
    // Re-resolve the link in the current script to detect staleness.
    const current = findScores(script).links.find((l) => l.id === link.id);
    if (!current) return { error: 'link-stale' };

    if (current.form.kind === 'long') {
        // Choose a bracket level that doesn't appear in newContent.
        let level = current.form.level;
        while (level <= MAX_BRACKET_LEVEL) {
            const closer = ']' + '='.repeat(level) + ']';
            if (!newContent.includes(closer)) break;
            level = level === 0 ? 2 : level + 1;   // skip level 1: spec emits [[ → [==[ → [===[
        }
        if (level > MAX_BRACKET_LEVEL) return { error: 'bracket-escalation-exhausted' };
        const opener = '[' + '='.repeat(level) + '[';
        const closer = ']' + '='.repeat(level) + ']';
        const before = script.slice(0, current.openerRange.from);
        const after  = script.slice(current.closerRange.to);
        return { script: before + opener + newContent + closer + after };
    }

    // Quoted form: re-escape.
    const q = current.form.quote;
    const before = script.slice(0, current.openerRange.from);
    const after  = script.slice(current.closerRange.to);
    const escaped = encodeQuoted(newContent, q);
    return { script: before + q + escaped + q + after };
}

function encodeQuoted(content: string, quote: '"' | "'"): string {
    let out = '';
    for (const c of content) {
        if (c === '\\')         out += '\\\\';
        else if (c === quote)   out += '\\' + quote;
        else if (c === '\n')    out += '\\n';
        else if (c === '\r')    out += '\\r';
        else if (c === '\t')    out += '\\t';
        else                    out += c;
    }
    return out;
}

const TEMPLATE_BODY = '\nL:1/4\nK:C\nC D E F |\n';

export interface InsertResult {
    script: string;
    newLink: ScoreLink;
    cursor: number; // cursor position inside the new score's content (for the script editor to optionally jump to)
}

export function insertNewScoreSnippet(script: string, cursor: number): InsertResult {
    const name = nextUnusedName(script);
    const snippet =
        (cursor > 0 && script[cursor - 1] !== '\n' ? '\n' : '') +
        `--@score: ${name}\nlocal ${name} = [[${TEMPLATE_BODY}]]\n`;
    const newScript = script.slice(0, cursor) + snippet + script.slice(cursor);
    const result = findScores(newScript);
    const newLink = result.links.find((l) => l.name === name);
    if (!newLink) throw new Error('insertNewScoreSnippet: failed to round-trip; this is a bug');
    return { script: newScript, newLink, cursor: newLink.contentRange.from };
}

function nextUnusedName(script: string): string {
    const taken = new Set(findScores(script).links.map((l) => l.name).filter(Boolean) as string[]);
    for (let n = 1; n < 1000; n++) {
        const candidate = `score_${n}`;
        if (!taken.has(candidate)) return candidate;
    }
    // Practically unreachable.
    return `score_${Date.now()}`;
}

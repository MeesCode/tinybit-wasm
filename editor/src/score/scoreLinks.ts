export interface Range { from: number; to: number; }

export type ScoreForm =
    | { kind: 'long'; level: number }            // [[ ]], [==[ ]==], etc; level = number of '=' chars
    | { kind: 'quoted'; quote: '"' | "'" };

export interface ScoreLink {
    id: string;
    name?: string;
    annotationLine: number;     // 1-based
    contentRange: Range;        // the actual ABC text (excludes brackets/quotes)
    openerRange: Range;
    closerRange: Range;
    form: ScoreForm;
    content: string;            // decoded (escapes resolved for quoted form)
}

export type Diagnostic =
    | { kind: 'unbound-annotation'; line: number; message: string }
    | { kind: 'duplicate-name'; name: string; line: number; message: string };

export interface FindScoresResult {
    links: ScoreLink[];
    diagnostics: Diagnostic[];
}

const ANNOTATION_LOOKAHEAD_LINES = 3;

export function findScores(script: string): FindScoresResult {
    const links: ScoreLink[] = [];
    const diagnostics: Diagnostic[] = [];
    const seenNames = new Set<string>();

    // Index every newline so we can map offset → line cheaply.
    const lineStarts: number[] = [0];
    for (let i = 0; i < script.length; i++) {
        if (script.charCodeAt(i) === 10) lineStarts.push(i + 1);
    }
    function lineOf(offset: number): number {
        // 1-based
        let lo = 0, hi = lineStarts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >>> 1;
            if (lineStarts[mid] <= offset) lo = mid;
            else hi = mid - 1;
        }
        return lo + 1;
    }

    let i = 0;
    while (i < script.length) {
        const ch = script[i];
        // Lua block comment `--[[ ... ]]`
        if (ch === '-' && script.startsWith('--[[', i)) {
            const end = script.indexOf(']]', i + 4);
            i = end === -1 ? script.length : end + 2;
            continue;
        }
        // Lua line comment
        if (ch === '-' && script[i + 1] === '-') {
            // Check for --@score[: name] pattern on this line (after stripping leading -- and whitespace)
            // We need the annotation to be the *whole* contentful payload of the comment line.
            const lineEnd = script.indexOf('\n', i);
            const lineSlice = script.slice(i, lineEnd === -1 ? script.length : lineEnd);
            const m = /^--\s*@score(?:\s*:\s*(\S+)?)?\s*$/.exec(lineSlice);
            if (m) {
                const annotationLine = lineOf(i);
                const rawName = m[1];
                const name = rawName && rawName.length > 0 ? rawName : undefined;
                const literalStart = findLiteralOpener(script, lineEnd + 1);
                if (literalStart == null) {
                    diagnostics.push({
                        kind: 'unbound-annotation',
                        line: annotationLine,
                        message: `--@score on line ${annotationLine} has no following string literal within ${ANNOTATION_LOOKAHEAD_LINES} non-blank lines`,
                    });
                    i = lineEnd === -1 ? script.length : lineEnd + 1;
                    continue;
                }
                const parsed = parseLiteral(script, literalStart);
                if (parsed == null) {
                    diagnostics.push({
                        kind: 'unbound-annotation',
                        line: annotationLine,
                        message: `--@score on line ${annotationLine}: malformed string literal`,
                    });
                    i = lineEnd === -1 ? script.length : lineEnd + 1;
                    continue;
                }
                const id = name ? `name:${name}` : `anon:${annotationLine}`;
                if (name) {
                    if (seenNames.has(name)) {
                        diagnostics.push({
                            kind: 'duplicate-name',
                            name,
                            line: annotationLine,
                            message: `Duplicate score name "${name}" on line ${annotationLine}`,
                        });
                    }
                    seenNames.add(name);
                }
                links.push({
                    id, name, annotationLine,
                    openerRange:  { from: parsed.openerFrom, to: parsed.openerTo },
                    contentRange: { from: parsed.contentFrom, to: parsed.contentTo },
                    closerRange:  { from: parsed.closerFrom, to: parsed.closerTo },
                    form: parsed.form,
                    content: parsed.content,
                });
                i = parsed.closerTo;
                continue;
            }
            // ordinary line comment — skip to EOL
            i = lineEnd === -1 ? script.length : lineEnd + 1;
            continue;
        }
        // String literals — skip their contents so embedded `--@score` is ignored.
        if (ch === '"' || ch === "'") {
            i = skipQuoted(script, i, ch);
            continue;
        }
        // Bare long-bracket literal (not annotated) — skip.
        if (ch === '[') {
            const opener = matchLongOpener(script, i);
            if (opener != null) {
                const closed = findLongCloser(script, opener.contentFrom, opener.level);
                i = closed == null ? script.length : closed.closerTo;
                continue;
            }
        }
        i++;
    }

    return { links, diagnostics };
}

interface ParsedLiteral {
    openerFrom: number; openerTo: number;
    contentFrom: number; contentTo: number;
    closerFrom: number; closerTo: number;
    form: ScoreForm;
    content: string;
}

function findLiteralOpener(script: string, from: number): number | null {
    let nonBlankLinesSeen = 0;
    let i = from;
    while (i < script.length) {
        // Skip leading whitespace (incl. newlines).
        const lineStart = i;
        let onlyWs = true;
        let j = i;
        while (j < script.length && script[j] !== '\n') {
            const c = script[j];
            if (c !== ' ' && c !== '\t' && c !== '\r') { onlyWs = false; break; }
            j++;
        }
        if (onlyWs) {
            // Blank line — advance past the newline and continue.
            i = j + 1;
            continue;
        }
        nonBlankLinesSeen++;
        if (nonBlankLinesSeen > ANNOTATION_LOOKAHEAD_LINES) return null;
        // Scan this line for the opener.
        const lineEnd = (() => {
            const n = script.indexOf('\n', lineStart);
            return n === -1 ? script.length : n;
        })();
        for (let k = lineStart; k < lineEnd; k++) {
            const c = script[k];
            if (c === '"' || c === "'") return k;
            if (c === '[') {
                if (matchLongOpener(script, k) != null) return k;
            }
        }
        i = lineEnd + 1;
    }
    return null;
}

interface LongOpener { openerFrom: number; openerTo: number; contentFrom: number; level: number; }
function matchLongOpener(script: string, from: number): LongOpener | null {
    if (script[from] !== '[') return null;
    let k = from + 1;
    let level = 0;
    while (script[k] === '=') { level++; k++; }
    if (script[k] !== '[') return null;
    return { openerFrom: from, openerTo: k + 1, contentFrom: k + 1, level };
}

function findLongCloser(script: string, from: number, level: number): { closerFrom: number; closerTo: number; contentTo: number } | null {
    const needle = ']' + '='.repeat(level) + ']';
    const idx = script.indexOf(needle, from);
    if (idx === -1) return null;
    return { closerFrom: idx, closerTo: idx + needle.length, contentTo: idx };
}

function parseLiteral(script: string, start: number): ParsedLiteral | null {
    const c = script[start];
    if (c === '[') {
        const opener = matchLongOpener(script, start);
        if (opener == null) return null;
        const close = findLongCloser(script, opener.contentFrom, opener.level);
        if (close == null) return null;
        return {
            openerFrom: opener.openerFrom, openerTo: opener.openerTo,
            contentFrom: opener.contentFrom, contentTo: close.contentTo,
            closerFrom: close.closerFrom, closerTo: close.closerTo,
            form: { kind: 'long', level: opener.level },
            content: script.slice(opener.contentFrom, close.contentTo),
        };
    }
    if (c === '"' || c === "'") {
        const close = findQuotedCloser(script, start + 1, c);
        if (close == null) return null;
        return {
            openerFrom: start, openerTo: start + 1,
            contentFrom: start + 1, contentTo: close.contentTo,
            closerFrom: close.contentTo, closerTo: close.contentTo + 1,
            form: { kind: 'quoted', quote: c as '"' | "'" },
            content: decodeQuoted(script.slice(start + 1, close.contentTo)),
        };
    }
    return null;
}

function skipQuoted(script: string, start: number, quote: string): number {
    const close = findQuotedCloser(script, start + 1, quote);
    return close == null ? script.length : close.contentTo + 1;
}

function findQuotedCloser(script: string, from: number, quote: string): { contentTo: number } | null {
    let k = from;
    while (k < script.length) {
        const c = script[k];
        if (c === '\\') { k += 2; continue; }
        if (c === '\n') return null; // Lua: unescaped newline ends string literal as an error
        if (c === quote) return { contentTo: k };
        k++;
    }
    return null;
}

function decodeQuoted(raw: string): string {
    let out = '';
    for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (c !== '\\') { out += c; continue; }
        const n = raw[i + 1];
        i++;
        switch (n) {
            case 'n':  out += '\n'; break;
            case 't':  out += '\t'; break;
            case 'r':  out += '\r'; break;
            case '"':  out += '"';  break;
            case "'":  out += "'";  break;
            case '\\': out += '\\'; break;
            default:   out += n;    break;
        }
    }
    return out;
}

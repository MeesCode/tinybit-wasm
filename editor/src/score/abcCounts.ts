// Engine-side limits from src/tinybit/audio.c. Kept here as the single source
// of truth for the editor — if the engine ever bumps these the editor reads
// the new values from here.
export const MUSIC_MAX_NOTES = 400;
export const MAX_VOICES      = 3;

export interface AbcCounts {
    notes:  number;  // max notes across all voices (each voice has its own MAX_NOTES pool)
    voices: number;  // 1 if no V: headers, else the count of distinct V: declarations
}

// Tokenizer-free, regex-based count. Doesn't try to be a faithful ABC parser —
// good enough to flag the in-editor capacity before the engine rejects it.
export function countAbc(abc: string): AbcCounts {
    // Per-voice note tally. `_default` is the implicit voice used when no
    // V: header has been encountered yet.
    const voiceNoteCounts = new Map<string, number>();
    const ensure = (v: string) => { if (!voiceNoteCounts.has(v)) voiceNoteCounts.set(v, 0); };
    let currentVoice = '_default';
    ensure(currentVoice);

    // Note glyph: optional accidental (^=_), pitch letter or rest (a-g/A-G/z/Z),
    // octave marks (,'), optional duration. Chord brackets `[CEG]` count as one
    // note. Inline `[V:NAME]` switches voice.
    const noteRe = /\[V:\s*(\S+)\]|\[[^\]\n]+\]|[_=^]?[a-gzA-GZ][,']*\d*\/?\d*/g;

    for (const raw of abc.split('\n')) {
        const noComment = raw.split('%')[0];
        const trimmed = noComment.trim();
        if (trimmed.length === 0) continue;

        // Information-field header. `V:` switches the current voice (and
        // creates it if unseen). Other single-letter colon headers are skipped.
        const headerMatch = /^([A-Za-z]):\s*(.*)$/.exec(trimmed);
        if (headerMatch) {
            if (headerMatch[1] === 'V') {
                const name = headerMatch[2].split(/\s+/)[0];
                if (name) {
                    currentVoice = name;
                    ensure(currentVoice);
                }
            }
            continue;
        }

        // Body line — scan for note glyphs and inline voice switches.
        let m: RegExpExecArray | null;
        while ((m = noteRe.exec(noComment))) {
            if (m[1] != null) {
                currentVoice = m[1];
                ensure(currentVoice);
                continue;
            }
            const tok = m[0];
            // Skip bracketed non-note constructs like `[K:C]` (inline key switch).
            if (tok.startsWith('[') && /^\[[A-Za-z]:/.test(tok)) continue;
            voiceNoteCounts.set(currentVoice, (voiceNoteCounts.get(currentVoice) ?? 0) + 1);
        }
    }

    // Per-voice MAX_NOTES is what the engine enforces; the badge reports the
    // worst-case voice so the user sees the constraint that matters.
    let maxNotes = 0;
    for (const n of voiceNoteCounts.values()) if (n > maxNotes) maxNotes = n;

    // If any named voice was used and the `_default` slot has no notes of its
    // own, drop it from the voice count — the named voices replace the
    // default rather than coexisting with it.
    let voices = voiceNoteCounts.size;
    const hasNamed = [...voiceNoteCounts.keys()].some((k) => k !== '_default');
    if (hasNamed && (voiceNoteCounts.get('_default') ?? 0) === 0) voices -= 1;
    if (voices < 1) voices = 1;

    return { notes: maxNotes, voices };
}

export type CountStatus = 'ok' | 'warn' | 'over';

// Yellow at >= 90% of capacity, red when over capacity.
export function noteStatus(notes: number): CountStatus {
    if (notes >  MUSIC_MAX_NOTES)            return 'over';
    if (notes >= Math.floor(MUSIC_MAX_NOTES * 0.9)) return 'warn';
    return 'ok';
}

// Yellow at >= max-1, red when over max.
export function voiceStatus(voices: number): CountStatus {
    if (voices >  MAX_VOICES)     return 'over';
    if (voices >= MAX_VOICES - 1) return 'warn';
    return 'ok';
}

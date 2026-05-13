import { StreamLanguage, type StreamParser } from '@codemirror/language';

// CodeMirror 6 doesn't ship a built-in ABC mode. We hand-roll a tiny
// StreamParser that highlights the common headers + bar lines + note glyphs.
// Deliberately approximate — ABC is a fiddly grammar and we only need enough
// to make the in-editor experience pleasant.

interface AbcState {
    atLineStart: boolean;
}

const abcParser: StreamParser<AbcState> = {
    startState: () => ({ atLineStart: true }),
    token(stream, state) {
        // Newlines
        if (stream.sol()) state.atLineStart = true;

        if (stream.eatSpace()) return null;

        // Line comment
        if (stream.match(/%.*/)) { state.atLineStart = false; return 'comment'; }

        // Info-field header at start of line: `X:`, `K:`, `M:`, `L:`, `Q:`, `T:`, `V:`, `W:`, `w:`, etc.
        if (state.atLineStart && stream.match(/[A-Za-z]:[^\n]*/)) {
            state.atLineStart = false;
            return 'keyword';
        }
        state.atLineStart = false;

        // Bar lines / repeats — order matters: longer matches first.
        if (stream.match(/\|\||::|\|:|:\||\|\d+|\|/)) return 'operator';

        // Chord literal `[CEG]`
        if (stream.match(/\[[^\]\n]*\]/)) return 'string';

        // Tuplet opener like `(3`, `(2`
        if (stream.match(/\(\d/)) return 'number';

        // Accidental + note + octave-marks + duration (e.g. `^C,2`, `=A'/4`, `_d3/2`, `z2`)
        if (stream.match(/[_=^]?[a-gA-Gz][,']*\d*\/?\d*/)) return 'variableName';

        // Standalone duration number
        if (stream.match(/\d+\/?\d*/)) return 'number';

        // Slurs, ties, decorations
        if (stream.match(/[()~.\-]/)) return 'operator';

        // Anything else: advance by one and don't highlight.
        stream.next();
        return null;
    },
    languageData: { commentTokens: { line: '%' } },
};

export function abcLang() {
    return StreamLanguage.define(abcParser);
}

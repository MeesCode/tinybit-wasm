export interface AbcEntry {
    text: string;
    abc?: string;
}

export interface AbcSection {
    title: string;
    body: AbcEntry[];
}

export const ABC_SECTIONS: AbcSection[] = [
    {
        title: 'Headers',
        body: [
            { text: 'Every score starts with header lines:' },
            { text: 'X:1 tune number. T:Title. M:4/4 meter. L:1/8 default note length. Q:1/4=120 tempo. K:C key.' },
            { text: 'A typical header block plus a few notes:', abc: 'X:1\nT:Example\nM:4/4\nL:1/8\nQ:1/4=120\nK:C\nCDEF GABc |' },
        ],
    },
    {
        title: 'Notes and accidentals',
        body: [
            { text: 'Uppercase letters C–B are the C major scale in octave 4. Lowercase c–b are octave 5.' },
            { text: 'Trailing , drops an octave (C, = C in octave 3). Trailing \' raises (c\' = C in octave 6).' },
            { text: 'Prefix ^ for sharp, _ for flat, = for natural.' },
            { text: 'Example mixing pitches and accidentals:', abc: 'K:C\n^C D _E =F C, c\'' },
        ],
    },
    {
        title: 'Durations',
        body: [
            { text: 'L:1/8 sets the default note length. A bare C is one default unit; C2 is two units; C/2 is half; C3/4 is three-quarters.' },
            { text: 'Example showing 1, 2, /2, and 3/4 durations:', abc: 'L:1/8\nK:C\nC C2 C/2 C3/4 C2 |' },
        ],
    },
    {
        title: 'Rests',
        body: [
            { text: 'z is a rest. z2 is twice the default length. Z is a whole-measure rest.' },
            { text: 'Example with rests:', abc: 'L:1/4\nK:C\nC z D z2 E |' },
        ],
    },
    {
        title: 'Bars and repeats',
        body: [
            { text: 'A single | ends a bar. || or |] ends a section. |: ... :| repeats the enclosed material once.' },
            { text: 'Example with a repeat:', abc: 'L:1/4\nK:C\n|: C D E F :| G A B c |]' },
        ],
    },
    {
        title: 'Chords',
        body: [
            { text: 'Square brackets group simultaneous notes. Up to 3 notes per chord in this engine.' },
            { text: 'C major, F major, G major chords:', abc: 'K:C\n[CEG] [FAc] [GBd] |' },
        ],
    },
    {
        title: 'Tuplets',
        body: [
            { text: '(3 marks the next three notes as a triplet (three notes in the time of two). (2 is a duplet, (5 a quintuplet, and so on.' },
            { text: 'Triplet example:', abc: 'L:1/8\nK:C\n(3CDE (3FGA c2 |' },
        ],
    },
    {
        title: 'Voices',
        body: [
            { text: 'A V: header introduces or switches to a voice. The engine supports up to 3 voices, played simultaneously.' },
            { text: 'Two-voice example (melody + bass):', abc: 'L:1/8\nK:C\nV:MELODY\nCDEF GABc |\nV:BASS\nC,4 G,4 |' },
        ],
    },
    {
        title: 'Engine limits',
        body: [
            { text: 'Notes per voice: 400. Voices per score: 3. SFX channel limit: 10 notes.' },
            { text: 'Sample rate: 22 kHz (browser playback retunes if the host AudioContext disagrees).' },
            { text: 'Waveform: SINE only. The other waveform constants exist in the API but the engine currently hard-codes SINE.' },
        ],
    },
];

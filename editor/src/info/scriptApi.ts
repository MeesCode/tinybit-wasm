export interface ApiEntry {
    name: string;
    signature: string;
    description: string;
    example?: string;
}

export interface ApiSection {
    title: string;
    items: ApiEntry[];
}

export const SCRIPT_API_SECTIONS: ApiSection[] = [
    {
        title: 'Hooks',
        items: [
            {
                name: '_draw',
                signature: 'function _draw() ... end',
                description: 'Called by the engine every frame. Define this in your script to draw your scene.',
                example: 'function _draw()\n  cls(0x0000)\n  sprite(0, 0, 8, 8, 60, 60, 8, 8)\nend',
            },
        ],
    },
    {
        title: 'Annotations',
        items: [
            {
                name: '--@score',
                signature: '--@score[: name]',
                description: 'Editor-only marker. Place above a Lua string literal containing an ABC score; the Score tab will list it as an editable score. Optional name shows up as a chip.',
                example: '--@score: tune\nlocal tune = [[\nL:1/4\nK:C\nC D E F |\n]]\nmusic(tune)',
            },
        ],
    },
    {
        title: 'Drawing',
        items: [
            { name: 'cls',          signature: 'cls()',                                                              description: 'Clear the display.' },
            { name: 'sprite',       signature: 'sprite(sx, sy, sw, sh, tx, ty, tw, th[, rotation])',                 description: 'Blit a region of the spritesheet to the display.' },
            { name: 'duplicate',    signature: 'duplicate(sx, sy, sw, sh, tx, ty, tw, th[, rotation])',              description: 'Copy a region of the display back to the display (useful for trails / effects).' },
            { name: 'line',         signature: 'line(x1, y1, x2, y2)',                                               description: 'Stroke a line. Uses the current stroke color and width.' },
            { name: 'rect',         signature: 'rect(x, y, w, h)',                                                   description: 'Stroke + fill a rectangle. Uses current stroke + fill colors.' },
            { name: 'oval',         signature: 'oval(x, y, w, h)',                                                   description: 'Stroke + fill an oval inscribed in (x, y, w, h).' },
            { name: 'pset',         signature: 'pset(x, y, color)',                                                  description: 'Set one pixel to color (RGBA4444 integer).' },
            { name: 'pget',         signature: 'pget(x, y) -> color',                                                description: 'Read the color at (x, y).' },
            { name: 'poly_add',     signature: 'poly_add(x, y)',                                                     description: 'Append a vertex to the in-progress polygon.' },
            { name: 'poly_clear',   signature: 'poly_clear()',                                                       description: 'Clear the polygon vertex list.' },
            { name: 'draw_polygon', signature: 'draw_polygon()',                                                     description: 'Stroke + fill the current polygon.' },
            { name: 'stroke',       signature: 'stroke(width, color)',                                               description: 'Set stroke width (pixels) and color (RGBA4444).' },
            { name: 'fill',         signature: 'fill(color)',                                                        description: 'Set fill color (RGBA4444).' },
            { name: 'text',         signature: 'text(color)',                                                        description: 'Set text color (RGBA4444). Affects subsequent print() calls.' },
            { name: 'cursor',       signature: 'cursor(x, y)',                                                       description: 'Set the text cursor position.' },
            { name: 'print',        signature: 'print(str)',                                                         description: 'Print str at the current cursor position.' },
        ],
    },
    {
        title: 'Color',
        items: [
            { name: 'rgb',  signature: 'rgb(r, g, b) -> color',         description: 'Pack 8-bit RGB into an RGBA4444 integer with alpha=255.' },
            { name: 'rgba', signature: 'rgba(r, g, b, a) -> color',     description: 'Pack 8-bit RGBA into an RGBA4444 integer.' },
            { name: 'hsb',  signature: 'hsb(h, s, b) -> color',         description: 'Pack 8-bit HSB into an RGBA4444 integer with alpha=255.' },
            { name: 'hsba', signature: 'hsba(h, s, b, a) -> color',     description: 'Pack 8-bit HSBA into an RGBA4444 integer.' },
        ],
    },
    {
        title: 'Audio',
        items: [
            {
                name: 'music',
                signature: 'music(abc_string)',
                description: 'Load and loop a music track from an ABC notation string on CHANNEL_MUSIC.',
                example: 'music([[\nL:1/4\nK:C\nC D E F |\n]])',
            },
            {
                name: 'sfx',
                signature: 'sfx(abc_string)',
                description: 'Play a one-shot SFX from an ABC notation string on CHANNEL_SFX.',
                example: 'sfx("c/4d/4e/4")',
            },
            { name: 'sfx_active', signature: 'sfx_active() -> bool',  description: 'Returns true while the SFX channel is still playing.' },
        ],
    },
    {
        title: 'Input',
        items: [
            { name: 'btn',   signature: 'btn(button) -> bool',   description: 'Returns true while button is held. Pass a button constant (A/B/UP/...).' },
            { name: 'btnp',  signature: 'btnp(button) -> bool',  description: 'Returns true only on the frame button was first pressed this hold.' },
            { name: 'A',     signature: 'A',                     description: 'Button constant: A.' },
            { name: 'B',     signature: 'B',                     description: 'Button constant: B.' },
            { name: 'UP',    signature: 'UP',                    description: 'Button constant: UP.' },
            { name: 'DOWN',  signature: 'DOWN',                  description: 'Button constant: DOWN.' },
            { name: 'LEFT',  signature: 'LEFT',                  description: 'Button constant: LEFT.' },
            { name: 'RIGHT', signature: 'RIGHT',                 description: 'Button constant: RIGHT.' },
            { name: 'START', signature: 'START',                 description: 'Button constant: START.' },
            { name: 'SELECT',signature: 'SELECT',                description: 'Button constant: SELECT.' },
        ],
    },
    {
        title: 'Misc',
        items: [
            { name: 'random', signature: 'random(min, max) -> int',  description: 'Random integer in [min, max] inclusive.' },
            { name: 'millis', signature: 'millis() -> int',          description: 'Current frame time in milliseconds.' },
            { name: 'sleep',  signature: 'sleep(ms)',                description: 'Block the engine for ms milliseconds.' },
            { name: 'peek',   signature: 'peek(addr) -> byte',       description: 'Read one byte from engine memory at addr.' },
            { name: 'poke',   signature: 'poke(addr, val)',          description: 'Write one byte (val & 0xFF) to engine memory at addr.' },
            { name: 'copy',   signature: 'copy(dst, src, size)',     description: 'Copy size bytes between two engine-memory addresses.' },
            { name: 'log',    signature: 'log(...)',                 description: 'Print arguments (separated by spaces) to the editor console.' },
        ],
    },
    {
        title: 'Constants',
        items: [
            { name: 'TB_SCREEN_WIDTH',  signature: 'TB_SCREEN_WIDTH = 128',     description: 'Display width in pixels.' },
            { name: 'TB_SCREEN_HEIGHT', signature: 'TB_SCREEN_HEIGHT = 128',    description: 'Display height in pixels.' },
            { name: 'SINE',             signature: 'SINE',                      description: 'Waveform constant. Lua globals exist for API parity, but the engine picks the actual per-voice waveform from the ABC V: header name (V:SINE/V:SAW/V:SQUARE/V:NOISE).' },
            { name: 'SAW',              signature: 'SAW',                       description: 'Waveform constant. See SINE for how waveforms are selected at playback time.' },
            { name: 'SQUARE',           signature: 'SQUARE',                    description: 'Waveform constant. See SINE for how waveforms are selected at playback time.' },
            { name: 'NOISE',            signature: 'NOISE',                     description: 'Waveform constant. See SINE for how waveforms are selected at playback time.' },
        ],
    },
];

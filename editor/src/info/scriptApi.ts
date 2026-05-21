export interface ApiParam {
    name: string;
    description: string;
}

export interface ApiEntry {
    name: string;
    signature: string;
    description: string;
    params?: ApiParam[];
    example?: string;
    tip?: string;
    /** Text inserted at the script-editor cursor when the user clicks Insert. Falls back to `signature`. */
    insert?: string;
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
                description: 'Define this function in your script. The engine calls it once per frame so you can draw the scene.',
                example: 'function _draw()\n  cls()\n  sprite(0, 60, 60)\nend',
                insert: 'function _draw()\n  -- draw your scene here\nend\n',
            },
        ],
    },
    {
        title: 'Annotations',
        items: [
            {
                name: '--@music',
                signature: '--@music[: name]',
                description: 'Editor-only marker. Place above a Lua string that holds an ABC music score; the Score tab will list it as an editable track. The optional name shows up as a chip in the Score tab.',
                example: '--@music: tune\nlocal tune = [[\nL:1/4\nK:C\nC D E F |\n]]\nmusic(tune)',
                insert: '--@music\n',
            },
            {
                name: '--@sfx',
                signature: '--@sfx[: name]',
                description: 'Editor-only marker. Place above a Lua string that holds a short ABC sound effect (up to 10 notes per voice); the Score tab will list it with the SFX cap. Optional name shows up as a chip.',
                example: '--@sfx: jump\nlocal jump = "c/4d/4e/4"\nsfx(jump)',
                insert: '--@sfx\n',
            },
        ],
    },
    {
        title: 'Drawing',
        items: [
            {
                name: 'cls',
                signature: 'cls()',
                description: 'Clear the whole display.',
                example: 'cls()',
            },
            {
                name: 'sprite',
                signature: 'sprite(n, x, y) | sprite(sx, sy, sw, sh, tx, ty, tw, th[, rotation])',
                description: 'Draw a piece of the spritesheet onto the display. The short form copies the n-th 8×8 cell to (x, y). The long form copies any source rectangle from the sheet to any target rectangle, with an optional rotation.',
                params: [
                    { name: 'n', description: 'Cell index 0–255. The sheet is a 16×16 grid of 8×8 cells: cell = row * 16 + col.' },
                    { name: 'x, y', description: 'Top-left target position in pixels.' },
                ],
                example: 'sprite(0, 60, 60)',
                tip: 'The 128×128 sheet has 16 cells per row, so row 1 starts at index 16, row 2 at 32, and so on.',
                insert: 'sprite(n, x, y)',
            },
            {
                name: 'duplicate',
                signature: 'duplicate(sx, sy, sw, sh, tx, ty, tw, th[, rotation])',
                description: 'Copy a rectangle of the display back to the display. Handy for motion trails or repeating patterns.',
            },
            {
                name: 'line',
                signature: 'line(x1, y1, x2, y2)',
                description: 'Draw a line from (x1, y1) to (x2, y2) using the current stroke color and width.',
                example: 'stroke(1, rgb(255, 255, 255))\nline(0, 0, 127, 127)',
            },
            {
                name: 'rect',
                signature: 'rect(x, y, w, h)',
                description: 'Draw a rectangle. The outline uses the stroke color and width; the inside uses the fill color.',
                example: 'fill(rgb(255, 0, 0))\nrect(10, 10, 30, 20)',
            },
            {
                name: 'oval',
                signature: 'oval(x, y, w, h)',
                description: 'Draw an oval that fits inside the rectangle (x, y, w, h). Outlined with stroke and filled with fill.',
            },
            {
                name: 'pset',
                signature: 'pset(x, y, color)',
                description: 'Set a single pixel at (x, y) to the given color.',
                params: [
                    { name: 'x, y', description: 'Pixel position, 0–127 for both axes.' },
                    { name: 'color', description: 'A packed color value from rgb(), rgba(), hsb(), or hsba().' },
                ],
            },
            {
                name: 'pget',
                signature: 'pget(x, y) -> color',
                description: 'Return the color at (x, y) as a packed color value.',
            },
            {
                name: 'poly_add',
                signature: 'poly_add(x, y)',
                description: 'Add a vertex (x, y) to the polygon you are building.',
            },
            {
                name: 'poly_clear',
                signature: 'poly_clear()',
                description: 'Throw away any vertices you have added so far so you can start a new polygon.',
            },
            {
                name: 'draw_polygon',
                signature: 'draw_polygon()',
                description: 'Draw the polygon built up with poly_add(): outline with stroke, inside with fill.',
                tip: 'A typical pattern is poly_clear(), several poly_add() calls, then draw_polygon().',
            },
            {
                name: 'stroke',
                signature: 'stroke(width, color)',
                description: 'Set the line width (in pixels) and outline color used by line, rect, oval, and draw_polygon.',
                params: [
                    { name: 'width', description: 'Line thickness in pixels.' },
                    { name: 'color', description: 'A packed color value from rgb(), rgba(), hsb(), or hsba().' },
                ],
            },
            {
                name: 'fill',
                signature: 'fill(color)',
                description: 'Set the fill color used by rect, oval, and draw_polygon.',
            },
            {
                name: 'text',
                signature: 'text(color)',
                description: 'Set the color used by print() for the text you draw.',
            },
            {
                name: 'cursor',
                signature: 'cursor(x, y)',
                description: 'Move the text cursor to (x, y). The next print() call starts here.',
            },
            {
                name: 'print',
                signature: 'print(str)',
                description: 'Draw str at the current text cursor position using the current text color.',
                example: 'cursor(10, 10)\ntext(rgb(255, 255, 255))\nprint("hello")',
            },
        ],
    },
    {
        title: 'Color',
        items: [
            {
                name: 'rgb',
                signature: 'rgb(r, g, b) -> color',
                description: 'Combine red, green, and blue (each 0–255) into a packed color value with full opacity.',
                params: [
                    { name: 'r', description: 'Red channel, 0–255.' },
                    { name: 'g', description: 'Green channel, 0–255.' },
                    { name: 'b', description: 'Blue channel, 0–255.' },
                ],
                example: 'local red = rgb(255, 0, 0)',
            },
            {
                name: 'rgba',
                signature: 'rgba(r, g, b, a) -> color',
                description: 'Combine red, green, blue, and alpha (each 0–255) into a packed color value. Use alpha < 255 for transparency.',
            },
            {
                name: 'hsb',
                signature: 'hsb(h, s, b) -> color',
                description: 'Combine hue, saturation, and brightness (each 0–255) into a packed color value with full opacity. Easier than rgb() for picking related colors.',
            },
            {
                name: 'hsba',
                signature: 'hsba(h, s, b, a) -> color',
                description: 'Combine hue, saturation, brightness, and alpha (each 0–255) into a packed color value.',
            },
        ],
    },
    {
        title: 'Audio',
        items: [
            {
                name: 'music',
                signature: 'music(abc_string)',
                description: 'Start a looping music track from an ABC notation string. Plays on the music channel.',
                example: 'music([[\nL:1/4\nK:C\nC D E F |\n]])',
                tip: 'You can author ABC tracks in the Score tab once you tag a string with --@music.',
            },
            {
                name: 'sfx',
                signature: 'sfx(abc_string)',
                description: 'Play a one-shot sound effect from an ABC notation string. Plays on the SFX channel.',
                example: 'sfx("c/4d/4e/4")',
            },
            {
                name: 'sfx_active',
                signature: 'sfx_active() -> bool',
                description: 'Returns true while the SFX channel is still playing. Use it to chain or gate sound effects.',
            },
        ],
    },
    {
        title: 'Input',
        items: [
            {
                name: 'btn',
                signature: 'btn(button) -> bool',
                description: 'Returns true for every frame the given button is held down.',
                params: [
                    { name: 'button', description: 'A button constant: A, B, UP, DOWN, LEFT, RIGHT, START, or SELECT.' },
                ],
                example: 'if btn(LEFT) then x = x - 1 end',
            },
            {
                name: 'btnp',
                signature: 'btnp(button) -> bool',
                description: 'Returns true only on the first frame the given button was pressed. Useful for one-shot actions like jumping or shooting.',
                example: 'if btnp(A) then sfx("c/4") end',
            },
            { name: 'A',     signature: 'A',     description: 'Button constant for the A button.' },
            { name: 'B',     signature: 'B',     description: 'Button constant for the B button.' },
            { name: 'UP',    signature: 'UP',    description: 'Button constant for the up direction.' },
            { name: 'DOWN',  signature: 'DOWN',  description: 'Button constant for the down direction.' },
            { name: 'LEFT',  signature: 'LEFT',  description: 'Button constant for the left direction.' },
            { name: 'RIGHT', signature: 'RIGHT', description: 'Button constant for the right direction.' },
            { name: 'START', signature: 'START', description: 'Button constant for the start button.' },
            { name: 'SELECT',signature: 'SELECT',description: 'Button constant for the select button.' },
        ],
    },
    {
        title: 'Misc',
        items: [
            {
                name: 'random',
                signature: 'random(min, max) -> int',
                description: 'Return a random whole number between min and max, including both ends.',
                example: 'local roll = random(1, 6)',
            },
            {
                name: 'millis',
                signature: 'millis() -> int',
                description: 'Return the current frame time in milliseconds. Handy for timing animations.',
            },
            {
                name: 'sleep',
                signature: 'sleep(ms)',
                description: 'Pause the engine for ms milliseconds. Blocks until the time has passed.',
                tip: 'Avoid sleep() inside _draw — it freezes the whole frame loop.',
            },
            {
                name: 'peek',
                signature: 'peek(addr) -> byte',
                description: 'Read one byte from the engine\'s raw memory at the given address. Advanced — most scripts will not need this.',
            },
            {
                name: 'poke',
                signature: 'poke(addr, val)',
                description: 'Write one byte (val & 0xFF) into the engine\'s raw memory at the given address. Advanced.',
            },
            {
                name: 'copy',
                signature: 'copy(dst, src, size)',
                description: 'Copy size bytes between two raw-memory addresses. Advanced.',
            },
            {
                name: 'log',
                signature: 'log(...)',
                description: 'Print the arguments to the editor\'s console pane, separated by spaces. Useful while debugging.',
                example: 'log("score:", score)',
            },
        ],
    },
    {
        title: 'Constants',
        items: [
            { name: 'TB_SCREEN_WIDTH',  signature: 'TB_SCREEN_WIDTH = 128',  description: 'Display width in pixels.' },
            { name: 'TB_SCREEN_HEIGHT', signature: 'TB_SCREEN_HEIGHT = 128', description: 'Display height in pixels.' },
            {
                name: 'SINE',
                signature: 'SINE',
                description: 'Waveform constant. Available for API symmetry, but the engine actually picks each voice\'s waveform from the ABC V: header name.',
                tip: 'Use V:SINE / V:SAW / V:SQUARE / V:NOISE inside your ABC score to choose a per-voice waveform.',
            },
            { name: 'SAW',    signature: 'SAW',    description: 'Waveform constant. See SINE for how the engine actually picks a waveform.' },
            { name: 'SQUARE', signature: 'SQUARE', description: 'Waveform constant. See SINE for how the engine actually picks a waveform.' },
            { name: 'NOISE',  signature: 'NOISE',  description: 'Waveform constant. See SINE for how the engine actually picks a waveform.' },
        ],
    },
];

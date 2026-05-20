export const PLAYER_BUTTONS = ['up', 'down', 'left', 'right', 'a', 'b'] as const;
export type PlayerButton = typeof PLAYER_BUTTONS[number];

// Engine button indices (mirrors BUTTONS map in editor/src/engine/tinybit.ts).
// Idx 6 (Start/Enter) and 7 (Select/Backspace) are deliberately not surfaced.
export const PLAYER_BUTTON_IDX: Record<PlayerButton, number> = {
    a:     0,
    b:     1,
    up:    2,
    down:  3,
    left:  4,
    right: 5,
};

export interface Rect {
    left:   number; // %, 0..100, relative to rendered image
    top:    number; // %
    width:  number; // %
    height: number; // %
}

export interface ShellLayout {
    imageUrl:    string;
    imageAspect: number;            // intrinsic width / intrinsic height
    screen:      Rect;
    buttons:     Record<PlayerButton, Rect>;
}

// Coordinates correspond to editor/public/player-shell.svg (viewBox 280×480).
// To swap the shell image: replace the file (or change imageUrl) and adjust
// these rects to match the new artwork.
export const shellLayout: ShellLayout = {
    imageUrl:    '/player-shell.svg',
    imageAspect: 280 / 480,
    screen:      { left: 10,    top: 5,    width: 80,    height: 46.7 },
    buttons: {
        up:    { left: 20,    top: 69.2, width: 10,    height: 7.9 },
        down:  { left: 20,    top: 77.1, width: 10,    height: 7.9 },
        left:  { left: 11.4,  top: 74.6, width: 13.6,  height: 5.8 },
        right: { left: 25,    top: 74.6, width: 13.6,  height: 5.8 },
        a:     { left: 79.3,  top: 69.6, width: 15.7,  height: 9.2 },
        b:     { left: 63.6,  top: 75.8, width: 15.7,  height: 9.2 },
    },
};

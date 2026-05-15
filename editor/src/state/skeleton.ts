export const SKELETON_SCRIPT = `-- Welcome to TinyBit. Press ▶ Play to run.
-- Click 🎮 Gallery in the toolbar to load an example cartridge.

function _draw()
    cls()
    cursor(34, 60)
    print("hello, world")
end
`;

export interface SkeletonShape {
    script: string;
    sprite: Uint8Array | null;
    cover:  Uint8Array | null;
    title:  string;
    author: string;
}

export function isUntouchedSkeleton(s: SkeletonShape): boolean {
    return s.script === SKELETON_SCRIPT
        && s.sprite === null
        && s.cover === null
        && s.title === ''
        && s.author === '';
}

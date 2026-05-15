import type { SketchState } from './sketchStore';

export const DEMO_TITLE  = 'Star Catcher';
export const DEMO_AUTHOR = 'TinyBit';

export const DEMO_SCRIPT = `-- Star Catcher — TinyBit demo
-- Arrow keys move the ship. Catch falling stars to score.

--@music
local bgm = [[
L:1/4
Q:1/4=120
C E G c | B G E C | F A c f | e c d2 | 
]]

--@sfx
local catch_sfx = [[
Q:1/4=150
c/4e/4g/4c/4
]]

local ship_x = 60
local score  = 0
local stars  = {}
for i = 1, 3 do
    stars[i] = { x = random(0, 120), y = random(-128, 0) }
end

music(bgm)

function _draw()
    if btn(LEFT)  then ship_x = ship_x - 2 end
    if btn(RIGHT) then ship_x = ship_x + 2 end
    if ship_x < 0   then ship_x = 0   end
    if ship_x > 120 then ship_x = 120 end

    for i = 1, #stars do
        local s = stars[i]
        s.y = s.y + 1
        local caught = s.y >= 112 and s.y <= 120
                   and s.x + 8 >= ship_x and s.x <= ship_x + 8
        if caught then
            score = score + 1
            sfx(catch_sfx)
            s.x = random(0, 120)
            s.y = random(-64, -8)
        elseif s.y > 128 then
            s.x = random(0, 120)
            s.y = random(-64, -8)
        end
    end

    cls()
    for i = 1, #stars do
        local s = stars[i]
        sprite(8, 0, 8, 8, s.x, s.y, 8, 8)
    end
    sprite(0, 0, 8, 8, ship_x, 120, 8, 8)
    cursor(4, 4)
    text(rgb(255, 255, 255))
    print("score " .. score)
end
`;

export async function loadDemo(
    sketch: SketchState,
    warn: (msg: string) => void,
): Promise<void> {
    sketch.setScript(DEMO_SCRIPT);
    sketch.setTitle(DEMO_TITLE);
    sketch.setAuthor(DEMO_AUTHOR);
    sketch.setCover(null);
    try {
        const res = await fetch('./demo-sprite.png');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        await sketch.setSpriteFromPng(bytes);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warn(`Could not load demo sprite: ${msg}`);
    }
}

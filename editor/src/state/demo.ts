import type { SketchState } from './sketchStore';

export const DEMO_TITLE  = 'Lucky Leprechaun';
export const DEMO_AUTHOR = 'TinyBit';

export const DEMO_SCRIPT = `-- Lucky Leprechaun — a little catching game.
--
-- Hold the LEFT and RIGHT arrow keys to move the leprechaun
-- along the grass. Catch the falling gold coins to grow your
-- score. Have fun!


-- ── music and sound ───────────────────────────────────────────

-- A short tune that plays in a loop while you play.
--@music
local background_music = [[
L:1/4
Q:1/4=120
C E G c | B G E C | F A c f | e c d2 |
]]

-- A little jingle that plays whenever you catch a coin.
--@sfx
local catch_sound = [[
Q:1/4=150
c/4e/4g/4c/4
]]


-- ── game state ────────────────────────────────────────────────

-- Where the leprechaun is standing. The screen is 128 pixels
-- wide, so x = 60 puts him near the middle.
local leprechaun_x = 60

-- How many coins the player has caught so far.
local score = 0

-- A list of falling coins. Each coin keeps track of its own
-- x (left/right) and y (up/down) position. We start them off
-- the top of the screen at random spots so they drop in one
-- by one.
local coins = {}
for i = 1, 3 do
    coins[i] = {
        x = random(0, 120),
        y = random(-128, 0),
    }
end

-- Start the music. It will keep playing on its own from now on.
music(background_music)


-- ── colors ────────────────────────────────────────────────────

-- Naming our colors up here keeps the drawing code below tidy.
local sky_color        = rgb(140, 210, 250)
local grass_color      = rgb( 70, 170,  70)
local score_color      = rgb(255, 255, 255)
local transparent      = rgba(0, 0, 0, 0)
local rainbow_colors = {
    rgb(230,  40,  40),  -- red
    rgb(240, 140,  30),  -- orange
    rgb(245, 220,  40),  -- yellow
    rgb( 50, 180,  60),  -- green
    rgb( 50, 110, 230),  -- blue
    rgb(130,  60, 190),  -- violet
}


-- ── drawing every frame ──────────────────────────────────────

-- _draw runs once per frame (about 60 times every second).
-- Anything we do in here happens "live" on the screen.
function _draw()

    -- Move the leprechaun while an arrow key is held down.
    if btn(LEFT)  then leprechaun_x = leprechaun_x - 2 end
    if btn(RIGHT) then leprechaun_x = leprechaun_x + 2 end

    -- Keep him from walking off the edges of the screen.
    if leprechaun_x < 0   then leprechaun_x = 0   end
    if leprechaun_x > 120 then leprechaun_x = 120 end

    -- Make every coin fall a little, and see if the leprechaun
    -- managed to catch it.
    for i = 1, #coins do
        local coin = coins[i]
        coin.y = coin.y + 1

        local at_ground_level = coin.y >= 112 and coin.y <= 120
        local touching_player = coin.x + 8 >= leprechaun_x
                            and coin.x <= leprechaun_x + 8

        if at_ground_level and touching_player then
            -- Caught! Score up, play the jingle, and respawn
            -- the coin somewhere above the screen.
            score = score + 1
            sfx(catch_sound)
            coin.x = random(0, 120)
            coin.y = random(-64, -8)
        elseif coin.y > 128 then
            -- Missed: the coin fell off the bottom. Send it
            -- back up so the game keeps going.
            coin.x = random(0, 120)
            coin.y = random(-64, -8)
        end
    end


    -- Now we paint the scene, back to front.

    cls()           -- wipe last frame's pixels
    stroke(0, 0)    -- shapes have no outline

    -- Blue sky covering the upper part of the screen.
    fill(sky_color)
    rect(0, 0, 128, 96)

    -- Rainbow! Imagine a huge ring just below the screen.
    -- We draw it six times in different colors, each one a
    -- little smaller than the last, so the colors stack up
    -- like a real rainbow.
    local center_x = 64
    local center_y = 180
    local radius   = 130
    for i = 1, 6 do
        fill(rainbow_colors[i])
        oval(center_x - radius, center_y - radius, radius * 2, radius * 2)
        radius = radius - 8
    end
    -- One last sky-colored circle hides the middle, so the
    -- rainbow looks like rings instead of a filled blob.
    fill(sky_color)
    oval(center_x - radius, center_y - radius, radius * 2, radius * 2)

    -- Green grass along the bottom.
    fill(grass_color)
    rect(0, 96, 128, 32)

    -- Draw each coin where it is right now.
    for i = 1, #coins do
        local coin = coins[i]
        sprite(8, 0, 8, 8, coin.x, coin.y, 8, 8)
    end

    -- Draw the leprechaun on top of the grass.
    sprite(0, 0, 8, 8, leprechaun_x, 120, 8, 8)

    -- Show the score in the top-left corner. The ".." joins
    -- the word "gold" together with the score number.
    fill(transparent)  -- so the letters don't sit on a box
    cursor(4, 4)
    text(score_color)
    print("gold " .. score)
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

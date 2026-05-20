//! Procedural drawing of the default cartridge frame onto the 256×256 RGBA canvas.

use crate::encoder::image::{CART_H, CART_RGBA_LEN, CART_W};

/// Fill an axis-aligned rectangle with a solid RGB color (alpha = 0xFF).
/// Coordinates are clipped to the canvas; zero/negative width or height is a no-op.
pub fn fill_rect(
    canvas: &mut [u8; CART_RGBA_LEN],
    x: i32, y: i32, w: i32, h: i32,
    color: [u8; 3],
) {
    if w <= 0 || h <= 0 { return; }
    let x0 = x.max(0) as usize;
    let y0 = y.max(0) as usize;
    let x1 = (x + w).clamp(0, CART_W as i32) as usize;
    let y1 = (y + h).clamp(0, CART_H as i32) as usize;
    if x0 >= x1 || y0 >= y1 { return; }
    for cy in y0..y1 {
        let row = cy * CART_W;
        for cx in x0..x1 {
            let p = (row + cx) * 4;
            canvas[p]     = color[0];
            canvas[p + 1] = color[1];
            canvas[p + 2] = color[2];
            canvas[p + 3] = 0xFF;
        }
    }
}

/// Draw a 1-pixel-thick stroke around the rect (x, y, w, h). The stroke sits
/// inside the rect (i.e. uses x..x+w and y..y+h as the outer bounds).
pub fn stroke_rect(
    canvas: &mut [u8; CART_RGBA_LEN],
    x: i32, y: i32, w: i32, h: i32, thickness: i32,
    color: [u8; 3],
) {
    if w <= 0 || h <= 0 || thickness <= 0 { return; }
    // Top
    fill_rect(canvas, x, y, w, thickness, color);
    // Bottom
    fill_rect(canvas, x, y + h - thickness, w, thickness, color);
    // Left
    fill_rect(canvas, x, y, thickness, h, color);
    // Right
    fill_rect(canvas, x + w - thickness, y, thickness, h, color);
}

const COLOR_BG:        [u8; 3] = [0x0d, 0x16, 0x12];
const COLOR_BODY:      [u8; 3] = [0x1d, 0x4a, 0x3a];
const COLOR_BODY_EDGE: [u8; 3] = [0x0a, 0x22, 0x18];
const COLOR_PLATE:     [u8; 3] = [0xe8, 0xd5, 0x6a];
const COLOR_WELL:      [u8; 3] = [0x0a, 0x22, 0x18];
const COLOR_INNER:     [u8; 3] = [0x3a, 0x7a, 0x5c];
const COLOR_PIN:       [u8; 3] = [0xd4, 0xa0, 0x2a];

// 10×10 quarter-circle mask. `1` = inside the rounded body (keep), `0` = outside
// (revert to background). Generated from the discrete formula
//     inside iff (x + 0.5)² + (y + 0.5)² <= r²   with r = 10.
// Indexed [y][x], with (0,0) at the corner. Symmetric — same mask is used at all
// four corners with appropriate axis flips at the call site.
const CORNER_MASK: [[u8; 10]; 10] = [
    [0, 0, 0, 0, 0, 0, 0, 1, 1, 1],
    [0, 0, 0, 0, 1, 1, 1, 1, 1, 1],
    [0, 0, 0, 1, 1, 1, 1, 1, 1, 1],
    [0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

/// Paint a single pin at (x, y) of width 6, height 12.
fn paint_pin(canvas: &mut [u8; CART_RGBA_LEN], x: i32) {
    fill_rect(canvas, x, 222, 6, 12, COLOR_PIN);
}

/// Apply the corner mask. (cx, cy) is the canvas pixel that corresponds to the
/// mask's (0, 0) cell. `flip_x` / `flip_y` mirror the mask index axes.
fn apply_corner_mask(
    canvas: &mut [u8; CART_RGBA_LEN],
    cx: i32, cy: i32,
    flip_x: bool, flip_y: bool,
) {
    for my in 0..10 {
        for mx in 0..10 {
            let bit = CORNER_MASK[my][mx];
            if bit != 0 { continue; }
            let dx = if flip_x { 9 - mx as i32 } else { mx as i32 };
            let dy = if flip_y { 9 - my as i32 } else { my as i32 };
            let px = cx + dx;
            let py = cy + dy;
            fill_rect(canvas, px, py, 1, 1, COLOR_BG);
        }
    }
}

/// Paint the full default cartridge frame into the canvas. After this returns,
/// the caller composites the cover and draws title/author text on top.
pub fn draw_default_frame(canvas: &mut [u8; CART_RGBA_LEN]) {
    // 1. Solid background everywhere.
    fill_rect(canvas, 0, 0, CART_W as i32, CART_H as i32, COLOR_BG);

    // 2. Body fill (20, 14, 216, 226).
    fill_rect(canvas, 20, 14, 216, 226, COLOR_BODY);
    // 3. Body stroke (3 px, inside the rect).
    stroke_rect(canvas, 20, 14, 216, 226, 3, COLOR_BODY_EDGE);
    // 4. Knock out the four corners back to background.
    apply_corner_mask(canvas,  20,  14, false, false); // top-left
    apply_corner_mask(canvas, 226,  14, true,  false); // top-right (cx = x+w-10)
    apply_corner_mask(canvas,  20, 230, false, true ); // bottom-left
    apply_corner_mask(canvas, 226, 230, true,  true ); // bottom-right

    // 5. Title plate (40, 24, 176, 30) with 2-px dark border.
    fill_rect(canvas, 40, 24, 176, 30, COLOR_PLATE);
    stroke_rect(canvas, 40, 24, 176, 30, 2, COLOR_BODY_EDGE);

    // 6. Screen well (56, 60, 144, 136) and the 1-px inner highlight.
    fill_rect(canvas, 56, 60, 144, 136, COLOR_WELL);
    stroke_rect(canvas, 60, 62, 136, 132, 1, COLOR_INNER);

    // 7. Pin row — 17 pins, x ∈ {30, 42, …, 222}, step 12, w=6, h=12, y=222.
    for i in 0..17 {
        paint_pin(canvas, 30 + i * 12);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fill_rect_writes_only_inside_bounds() {
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        fill_rect(arr, 10, 20, 5, 3, [0x11, 0x22, 0x33]);

        // Inside the rect: (10..15, 20..23) is filled.
        for cy in 20..23 {
            for cx in 10..15 {
                let p = (cy * CART_W + cx) * 4;
                assert_eq!(arr[p], 0x11);
                assert_eq!(arr[p + 1], 0x22);
                assert_eq!(arr[p + 2], 0x33);
                assert_eq!(arr[p + 3], 0xFF);
            }
        }
        // Just outside on the right: (15, 20) untouched.
        let p = (20 * CART_W + 15) * 4;
        assert_eq!(arr[p], 0);
        // Just outside below: (10, 23) untouched.
        let p2 = (23 * CART_W + 10) * 4;
        assert_eq!(arr[p2], 0);
    }

    #[test]
    fn fill_rect_clips_to_canvas() {
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        // Off-canvas rect — must not panic and must not write anything.
        fill_rect(arr, -10, -10, 5, 5, [0xFF, 0, 0]);
        // Crosses right edge — only the in-bounds part is written.
        fill_rect(arr, 254, 100, 10, 1, [0xFF, 0, 0]);
        let p254 = (100 * CART_W + 254) * 4;
        let p255 = (100 * CART_W + 255) * 4;
        assert_eq!(arr[p254], 0xFF);
        assert_eq!(arr[p255], 0xFF);
    }

    #[test]
    fn stroke_rect_draws_just_the_border() {
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        stroke_rect(arr, 50, 50, 10, 10, 1, [0xAB, 0xCD, 0xEF]);

        // Border pixel.
        let pb = (50 * CART_W + 50) * 4;
        assert_eq!(arr[pb], 0xAB);
        // Interior pixel (51, 51) is NOT part of the stroke.
        let pi = (51 * CART_W + 51) * 4;
        assert_eq!(arr[pi], 0);
        // Bottom-right corner of the stroke (59, 59) IS drawn.
        let pbr = (59 * CART_W + 59) * 4;
        assert_eq!(arr[pbr], 0xAB);
    }

    #[test]
    fn draw_default_frame_fills_background_color() {
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        draw_default_frame(arr);
        // Top-left corner is *outside* the body — must be the background color #0d1612.
        let p = 0;
        assert_eq!(arr[p],     0x0d);
        assert_eq!(arr[p + 1], 0x16);
        assert_eq!(arr[p + 2], 0x12);
        assert_eq!(arr[p + 3], 0xFF);
    }

    #[test]
    fn draw_default_frame_paints_title_plate_yellow() {
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        draw_default_frame(arr);
        // Center of the title plate: (128, 39) must be the plate fill #e8d56a.
        let p = (39 * CART_W + 128) * 4;
        assert_eq!(arr[p],     0xe8);
        assert_eq!(arr[p + 1], 0xd5);
        assert_eq!(arr[p + 2], 0x6a);
    }

    #[test]
    fn draw_default_frame_paints_screen_well_dark() {
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        draw_default_frame(arr);
        // (57, 61) is inside the screen well (56..200, 60..196) but outside the
        // inner border (60..196, 62..194), so it must be #0a2218.
        let p = (61 * CART_W + 57) * 4;
        assert_eq!(arr[p],     0x0a);
        assert_eq!(arr[p + 1], 0x22);
        assert_eq!(arr[p + 2], 0x18);
    }

    #[test]
    fn draw_default_frame_rounds_body_corners() {
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        draw_default_frame(arr);
        // Body top-left corner pixel (20, 14) — outside the 10-px radius arc, so
        // it should be the *background* color, not the body color.
        let p = (14 * CART_W + 20) * 4;
        assert_eq!(arr[p],     0x0d, "expected background at corner");
        assert_eq!(arr[p + 1], 0x16);
        assert_eq!(arr[p + 2], 0x12);
        // A pixel between the well (ends y=196) and the pin row (starts y=222) —
        // this strip is body-fill only.
        let q = (200 * CART_W + 100) * 4;
        assert_eq!(arr[q],     0x1d);
        assert_eq!(arr[q + 1], 0x4a);
        assert_eq!(arr[q + 2], 0x3a);
    }

    #[test]
    fn draw_default_frame_pin_row_present() {
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        draw_default_frame(arr);
        // Center of the first pin (x=30..36, y=222..234) → (32, 225).
        let p = (225 * CART_W + 32) * 4;
        assert_eq!(arr[p],     0xd4);
        assert_eq!(arr[p + 1], 0xa0);
        assert_eq!(arr[p + 2], 0x2a);
    }
}

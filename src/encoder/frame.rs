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
}

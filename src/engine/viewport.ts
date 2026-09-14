/**
 * The geometry of the race view, in one place.
 *
 * The original draws a 256x200 window into a buffer of 272 bytes per row in segment 6D78 and copies it to
 * VRAM at x = 32, leaving 32 blank columns either side of the mode 13h screen. Every one of those numbers
 * was a literal scattered through the renderer and the physics; here they are derived from one width and
 * one height, so the port can draw a wider view of the same world.
 *
 * `DOS_VIEWPORT` reproduces the original's numbers exactly and is the default everywhere, so the golden
 * captures stay the arbiter of correctness. Nothing else in this file may drift from them: see
 * `test/engine/viewport.test.ts`, which pins every field.
 *
 * Widening is possible at all because the world is a 192x192-tile torus (0xC00 pixels, wrapping) with no
 * camera clamp, so there is always more map to show. See re/notes/60-tiles-blit.md.
 */

export interface Viewport {
  /** Visible pixels per row (256 in the original). */
  readonly width: number;
  /** Visible rows (200 in the original: the whole of mode 13h). */
  readonly height: number;
  /** Blank margin inside the back buffer, left and top, that the fine scroll slides into. */
  readonly margin: number;
  /** Bytes per buffer row: the visible width plus the margin. */
  readonly stride: number;
  /** Tile columns and rows the tile layer draws, one more than the view needs for the sub-tile offset. */
  readonly cols: number;
  readonly rows: number;
  /** Size of the back buffer, and the mask every offset in it is taken modulo. */
  readonly bufSize: number;
  readonly mask: number;
  /** Buffer offset of the top-left visible pixel. */
  readonly origin: number;
  /** Sprites are clipped to this many rows: the visible ones plus a car's height. */
  readonly clipH: number;
  /** Where fn 0630 parks a sprite that overflows the bottom: the first row the copy never reads. */
  readonly overflowDi: number;
  /** Half the view, which is where the camera anchors put the car it follows. */
  readonly halfW: number;
  readonly halfH: number;
  /** Head to head: how far apart the two cars may drift before one counts as left behind. */
  readonly h2hX: number;
  readonly h2hY: number;
  /** The same thresholds as seen from the other side of the world wrap. */
  readonly h2hWrapX: number;
  readonly h2hWrapY: number;
  /** Where a head-to-head banner has finished sliding off to the right. */
  readonly bannerOffRight: number;
  /** The output frame: the view centred in a screen `outX` pixels wider on each side. */
  readonly outWidth: number;
  readonly outX: number;
  /**
   * The window the *game* uses, as opposed to the one it draws. It decides [1250], which gates collision
   * sound, the AI's catch-up boost and jump particles. It follows the view, so what you can see is what is
   * live; pinning it to 256x224 instead would keep the AI bit-faithful at any width.
   */
  readonly logicWidth: number;
  readonly logicClipH: number;
}

const CAR = 0x18;                   // a car sprite is 24x24: the slack in clipH and in the H2H thresholds
const WORLD = 0xC00;                // the map wraps every 3072 pixels
const MARGIN = 16;
const OUT_X = 32;

const nextPow2 = (n: number): number => { let v = 1; while (v < n) v *= 2; return v; };

/**
 * `width` must be a multiple of 16 (a tile) and `height` a multiple of 8. Widths of 256 + 64n are the ones
 * to prefer: the animated water tile of rounds 1, 3 and 5 is phased on `camX & 0x1F`, so only a half-widening
 * that is a multiple of 32 leaves the picture identical to the original's in the columns they share.
 */
export function makeViewport(width = 256, height = 200): Viewport {
  if (width % 16 !== 0 || width < 256) throw new Error(`viewport width ${width} must be a multiple of 16, at least 256`);
  if (height % 8 !== 0 || height < 200) throw new Error(`viewport height ${height} must be a multiple of 8, at least 200`);
  const stride = width + MARGIN;
  const cols = width / 16 + 1;
  if (cols > 192) throw new Error(`viewport width ${width} is wider than the world`);
  const origin = MARGIN * stride + MARGIN;
  // one row past the visible area, so the bottom-overflow quirk of fn 0630 has somewhere to land. At the
  // original's size this lands on 0x10000 exactly, which is what keeps its 16-bit wrap-around intact.
  const bufSize = nextPow2(origin + (height + 1) * stride);
  const clipH = height + CAR;
  return {
    width, height, margin: MARGIN, stride,
    cols, rows: Math.ceil(height / 16) + 1,
    bufSize, mask: bufSize - 1,
    origin, clipH, overflowDi: origin + height * stride,
    halfW: width >> 1, halfH: height >> 1,
    h2hX: width - CAR, h2hY: height - CAR,
    h2hWrapX: WORLD - (width - CAR), h2hWrapY: WORLD - (height - CAR),
    bannerOffRight: width + 0x58,
    outWidth: width + 2 * OUT_X, outX: OUT_X,
    logicWidth: width, logicClipH: clipH,
  };
}

/** The original's geometry: 256x200 at a stride of 0x110 in a 64 KB segment. */
export const DOS_VIEWPORT: Viewport = makeViewport();

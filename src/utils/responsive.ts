/**
 * Responsive UI utilities.
 *
 * Provides helpers to calculate device-appropriate font sizes and element
 * dimensions so that buttons and labels remain touch-friendly across screen
 * sizes.  All values are in CSS pixels (which equal logical Phaser pixels when
 * the game is running in Scale.RESIZE mode).
 */

/** Minimum recommended touch-target size in CSS pixels (WCAG / Apple HIG). */
export const MIN_TOUCH_TARGET_PX = 44;

/** Mobile breakpoint width in CSS pixels. */
export const MOBILE_BREAKPOINT_PX = 768;

/** Reference resolution the game UI was originally designed for. */
const REFERENCE_WIDTH = 1920;
const REFERENCE_HEIGHT = 1080;

/**
 * Compute a UI scale factor relative to the reference resolution (1920×1080).
 * Clamped to [minScale, 1.0] so elements never exceed the reference size.
 *
 * @param screenWidth  - Actual screen width in CSS pixels
 * @param screenHeight - Actual screen height in CSS pixels
 * @param minScale     - Minimum allowed scale (default 0.35)
 */
export function uiScale(
  screenWidth: number,
  screenHeight: number,
  minScale = 0.35,
): number {
  const raw = Math.min(screenWidth / REFERENCE_WIDTH, screenHeight / REFERENCE_HEIGHT);
  return Math.max(minScale, Math.min(1, raw));
}

/**
 * Return a Phaser-compatible font-size string that scales with the viewport.
 *
 * @param basePx       - Font size designed for a 1920×1080 viewport (in px)
 * @param screenWidth  - Current screen width in CSS pixels
 * @param screenHeight - Current screen height in CSS pixels
 * @param minPx        - Absolute minimum font size in px (default 12)
 * @param maxPx        - Absolute maximum font size in px (default 96)
 */
export function responsiveFontSize(
  basePx: number,
  screenWidth: number,
  screenHeight: number,
  minPx = 12,
  maxPx = 96,
): string {
  const scale = uiScale(screenWidth, screenHeight);
  const size = Math.round(basePx * scale);
  return `${Math.max(minPx, Math.min(maxPx, size))}px`;
}

/**
 * Returns `true` when the screen width is below the mobile breakpoint (768 px).
 */
export function isMobileWidth(screenWidth: number): boolean {
  return screenWidth < MOBILE_BREAKPOINT_PX;
}

/**
 * Ensure a logical-pixel value is at least `MIN_TOUCH_TARGET_PX` so that
 * interactive elements remain comfortably tappable on touch screens.
 *
 * @param desiredPx - Desired element size in CSS pixels
 */
export function touchSafeSize(desiredPx: number): number {
  return Math.max(desiredPx, MIN_TOUCH_TARGET_PX);
}

/**
 * Scale a base value from the reference resolution to the current screen.
 *
 * @param basePx       - Value designed for REFERENCE_WIDTH
 * @param screenWidth  - Actual screen width
 * @param screenHeight - Actual screen height (used to pick the tighter axis)
 * @param minPx        - Optional minimum (default 0 – no floor)
 */
export function scalePx(
  basePx: number,
  screenWidth: number,
  screenHeight: number,
  minPx = 0,
): number {
  const scale = uiScale(screenWidth, screenHeight);
  return Math.max(minPx, Math.round(basePx * scale));
}

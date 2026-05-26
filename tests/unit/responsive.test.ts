/**
 * @jest-environment jsdom
 *
 * Feature: Responsive UI sizing utilities
 *
 * BDD-style tests that specify how the responsive helper functions should
 * behave across different screen sizes so that the game UI remains touch-
 * friendly and readable on any device.
 */

import {
  uiScale,
  responsiveFontSize,
  isMobileWidth,
  touchSafeSize,
  scalePx,
  MIN_TOUCH_TARGET_PX,
  MOBILE_BREAKPOINT_PX,
} from '../../src/utils/responsive';

// ---------------------------------------------------------------------------
// Feature: UI scale factor
// ---------------------------------------------------------------------------

describe('Feature: UI scale factor', () => {
  describe('Scenario: Desktop viewport (1920×1080)', () => {
    it('Then the scale factor should be 1.0 (full size)', () => {
      expect(uiScale(1920, 1080)).toBe(1);
    });
  });

  describe('Scenario: Large desktop viewport (2560×1440)', () => {
    it('Then the scale factor is capped at 1.0 so elements do not grow beyond design size', () => {
      expect(uiScale(2560, 1440)).toBe(1);
    });
  });

  describe('Scenario: Mobile viewport (375×667)', () => {
    it('Then the scale factor is clamped to the minimum (0.35) to keep UI readable', () => {
      // Raw scale = min(375/1920, 667/1080) ≈ min(0.195, 0.617) = 0.195 < 0.35
      expect(uiScale(375, 667)).toBe(0.35);
    });
  });

  describe('Scenario: Tablet viewport (768×1024)', () => {
    it('Then the scale factor is between the minimum and 1.0', () => {
      const scale = uiScale(768, 1024);
      expect(scale).toBeGreaterThan(0.35);
      expect(scale).toBeLessThanOrEqual(1);
    });
  });

  describe('Scenario: Custom minimum scale', () => {
    it('Then the custom minimum is respected when the raw scale is even lower', () => {
      // Very small screen with custom 0.5 minimum
      expect(uiScale(200, 200, 0.5)).toBe(0.5);
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: Responsive font size
// ---------------------------------------------------------------------------

describe('Feature: Responsive font size', () => {
  describe('Scenario: Desktop viewport receives the full design size', () => {
    it('Then a 22 px base returns "22px" on 1920×1080', () => {
      expect(responsiveFontSize(22, 1920, 1080)).toBe('22px');
    });

    it('Then an 82 px title base returns "82px" on 1920×1080', () => {
      expect(responsiveFontSize(82, 1920, 1080)).toBe('82px');
    });
  });

  describe('Scenario: Mobile viewport receives a scaled-down but readable size', () => {
    it('Then the returned size is at least the specified minimum', () => {
      const size = responsiveFontSize(22, 375, 667, 12);
      const px = parseInt(size, 10);
      expect(px).toBeGreaterThanOrEqual(12);
    });

    it('Then the returned size does not exceed the base size', () => {
      const size = responsiveFontSize(22, 375, 667, 12);
      const px = parseInt(size, 10);
      expect(px).toBeLessThanOrEqual(22);
    });

    it('Then the string ends with "px"', () => {
      expect(responsiveFontSize(22, 375, 667)).toMatch(/^\d+px$/);
    });
  });

  describe('Scenario: Maximum cap prevents oversized fonts on large displays', () => {
    it('Then a 200 px base on a 4K screen is capped at the specified maximum', () => {
      const size = responsiveFontSize(200, 3840, 2160, 12, 96);
      const px = parseInt(size, 10);
      expect(px).toBeLessThanOrEqual(96);
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: Mobile viewport detection
// ---------------------------------------------------------------------------

describe('Feature: Mobile viewport detection', () => {
  describe('Scenario: Width below the breakpoint', () => {
    it('Then isMobileWidth returns true for 375 px', () => {
      expect(isMobileWidth(375)).toBe(true);
    });

    it('Then isMobileWidth returns true for 767 px (one below breakpoint)', () => {
      expect(isMobileWidth(767)).toBe(true);
    });
  });

  describe('Scenario: Width at or above the breakpoint', () => {
    it('Then isMobileWidth returns false exactly at the breakpoint', () => {
      expect(isMobileWidth(MOBILE_BREAKPOINT_PX)).toBe(false);
    });

    it('Then isMobileWidth returns false for 1920 px (desktop)', () => {
      expect(isMobileWidth(1920)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: Touch-safe element sizing
// ---------------------------------------------------------------------------

describe('Feature: Touch-safe element sizing', () => {
  describe('Scenario: Desired size is already large enough', () => {
    it('Then touchSafeSize returns the desired size unchanged', () => {
      expect(touchSafeSize(80)).toBe(80);
      expect(touchSafeSize(MIN_TOUCH_TARGET_PX)).toBe(MIN_TOUCH_TARGET_PX);
    });
  });

  describe('Scenario: Desired size is smaller than the minimum touch target', () => {
    it('Then touchSafeSize returns MIN_TOUCH_TARGET_PX', () => {
      expect(touchSafeSize(20)).toBe(MIN_TOUCH_TARGET_PX);
      expect(touchSafeSize(0)).toBe(MIN_TOUCH_TARGET_PX);
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: Proportional pixel scaling
// ---------------------------------------------------------------------------

describe('Feature: Proportional pixel scaling', () => {
  describe('Scenario: Desktop reference resolution', () => {
    it('Then scalePx returns the base value unchanged at 1920×1080', () => {
      expect(scalePx(100, 1920, 1080)).toBe(100);
    });
  });

  describe('Scenario: Scaled viewport', () => {
    it('Then scalePx applies the ui scale factor and rounds to an integer', () => {
      // uiScale(768, 1024) ≈ 0.4 → scalePx(100, 768, 1024) ≈ 40
      const result = scalePx(100, 768, 1024);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeLessThan(100);
    });

    it('Then the optional minPx floor prevents the result from going below zero', () => {
      // Even with a very small viewport, a minimum can be enforced
      const result = scalePx(10, 375, 667, 8);
      expect(result).toBeGreaterThanOrEqual(8);
    });
  });
});

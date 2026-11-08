// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { THEMES, HEADING_FONTS, applyTheme, contrast, mix, themeVars } from '../../src/web/themes';

describe('themes', () => {
  it('provides 15 unique, valid themes', () => {
    expect(THEMES).toHaveLength(15); expect(new Set(THEMES.map(t => t.id)).size).toBe(15);
    for (const t of THEMES) { for (const c of [t.navy, t.accent, t.mist]) expect(c).toMatch(/^#[0-9a-f]{6}$/i); expect(HEADING_FONTS[t.font]).toBeTruthy(); }
  });
  it('keeps text readable on every theme (white on buttons, white on dark backgrounds)', () => {
    for (const t of THEMES) {
      expect(contrast('#ffffff', t.navy), t.id).toBeGreaterThan(12);
      expect(contrast('#ffffff', mix(t.accent, '#000000', 0.22)), t.id).toBeGreaterThan(4.5); // button gradient end
      expect(contrast('#ffffff', t.accent), t.id).toBeGreaterThan(3.5);
      expect(contrast(t.navy, t.mist), t.id).toBeGreaterThan(12); // dark text on page background
    }
  });
  it('emits every CSS variable the stylesheet uses', () => {
    const v = themeVars(THEMES[1]);
    for (const k of ['--c-navy', '--c-navy-800', '--c-navy-700', '--c-navy-600', '--c-accent', '--c-accent-600', '--c-accent-400', '--c-accent-100', '--c-mist']) expect(v[k]).toMatch(/^\d+ \d+ \d+$/);
  });
  it('applies a theme and heading font to the document, falling back to the default for unknown ids', () => {
    applyTheme('crimson-dark', 'playfair'); const root = document.documentElement;
    expect(root.style.getPropertyValue('--c-accent')).toBe('220 38 38'); expect(root.style.getPropertyValue('--font-heading')).toContain('Playfair');
    expect(document.head.querySelector('link[href*="Playfair"]')).toBeTruthy();
    applyTheme('does-not-exist'); expect(root.style.getPropertyValue('--c-accent')).toBe('8 123 255');
    applyTheme('noorix', ''); expect(root.style.getPropertyValue('--font-heading')).toContain('Inter');
  });
});

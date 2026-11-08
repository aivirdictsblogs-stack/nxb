// 15 website themes. All derive from just two colours (dark base + accent) so every shade stays consistent.
export type Theme = { id: string; name: string; navy: string; accent: string; mist: string; font: string; vibe: string };
export const HEADING_FONTS: Record<string, { label: string; css: string; gf?: string }> = {
  default: { label: 'Clean (system)', css: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  poppins: { label: 'Poppins — modern', css: '"Poppins", system-ui, sans-serif', gf: 'Poppins:wght@600;700;800' },
  outfit: { label: 'Outfit — sleek', css: '"Outfit", system-ui, sans-serif', gf: 'Outfit:wght@600;700;800' },
  sora: { label: 'Sora — techy', css: '"Sora", system-ui, sans-serif', gf: 'Sora:wght@600;700;800' },
  space: { label: 'Space Grotesk — futuristic', css: '"Space Grotesk", system-ui, sans-serif', gf: 'Space+Grotesk:wght@600;700' },
  montserrat: { label: 'Montserrat — bold', css: '"Montserrat", system-ui, sans-serif', gf: 'Montserrat:wght@600;700;800;900' },
  lexend: { label: 'Lexend — friendly', css: '"Lexend", system-ui, sans-serif', gf: 'Lexend:wght@600;700;800' },
  raleway: { label: 'Raleway — elegant', css: '"Raleway", system-ui, sans-serif', gf: 'Raleway:wght@600;700;800;900' },
  playfair: { label: 'Playfair Display — luxury serif', css: '"Playfair Display", Georgia, serif', gf: 'Playfair+Display:wght@600;700;800;900' },
  dmserif: { label: 'DM Serif Display — editorial', css: '"DM Serif Display", Georgia, serif', gf: 'DM+Serif+Display' },
};
export const THEMES: Theme[] = [
  { id: 'noorix', name: 'Noorix Electric', navy: '#071426', accent: '#087BFF', mist: '#F4F7FC', font: 'default', vibe: 'Original brand' },
  { id: 'midnight-violet', name: 'Midnight Violet', navy: '#0d0a1f', accent: '#7c3aed', mist: '#F6F4FD', font: 'poppins', vibe: 'Creative & premium' },
  { id: 'emerald-night', name: 'Emerald Night', navy: '#06201a', accent: '#059669', mist: '#F1F8F5', font: 'outfit', vibe: 'Fresh & trusted' },
  { id: 'crimson-dark', name: 'Crimson Dark', navy: '#1a0a0d', accent: '#dc2626', mist: '#FBF3F3', font: 'montserrat', vibe: 'Bold & energetic' },
  { id: 'ocean-teal', name: 'Ocean Teal', navy: '#04222b', accent: '#0e7490', mist: '#F0F8FA', font: 'lexend', vibe: 'Calm & modern' },
  { id: 'sunset-orange', name: 'Sunset Orange', navy: '#1c0f08', accent: '#c2410c', mist: '#FCF5F0', font: 'poppins', vibe: 'Warm & friendly' },
  { id: 'rose-luxe', name: 'Rose Luxe', navy: '#1f0a14', accent: '#db2777', mist: '#FCF2F7', font: 'playfair', vibe: 'Stylish & luxury' },
  { id: 'royal-indigo', name: 'Royal Indigo', navy: '#0b1033', accent: '#4f46e5', mist: '#F3F3FD', font: 'sora', vibe: 'Professional & tech' },
  { id: 'sky-slate', name: 'Sky Slate', navy: '#0f172a', accent: '#0369a1', mist: '#F1F6FA', font: 'default', vibe: 'Corporate clean' },
  { id: 'forest-lime', name: 'Forest Green', navy: '#0b1a0b', accent: '#15803d', mist: '#F2F8F2', font: 'raleway', vibe: 'Natural & growth' },
  { id: 'graphite', name: 'Graphite Mono', navy: '#111111', accent: '#52525b', mist: '#F5F5F6', font: 'space', vibe: 'Minimal monochrome' },
  { id: 'plum', name: 'Deep Plum', navy: '#1a0b1f', accent: '#a21caf', mist: '#FAF3FB', font: 'dmserif', vibe: 'Editorial & bold' },
  { id: 'cyber-cyan', name: 'Cyber Cyan', navy: '#050816', accent: '#0891b2', mist: '#F0F7FA', font: 'space', vibe: 'Futuristic gaming' },
  { id: 'ruby-wine', name: 'Ruby Wine', navy: '#200a14', accent: '#be123c', mist: '#FBF2F5', font: 'playfair', vibe: 'Rich & elegant' },
  { id: 'cobalt-steel', name: 'Cobalt Steel', navy: '#0a1929', accent: '#1d4ed8', mist: '#F2F5FB', font: 'outfit', vibe: 'Trust & finance' },
];
const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export const mix = (a: string, b: string, t: number) => { const x = hex(a), y = hex(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
const rgb = (h: string) => hex(h).join(' ');
export function lum(h: string) { const [r, g, b] = hex(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
export const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export function themeVars(t: Theme): Record<string, string> {
  return { '--c-navy': rgb(t.navy), '--c-navy-800': rgb(mix(t.navy, '#ffffff', 0.05)), '--c-navy-700': rgb(mix(t.navy, '#ffffff', 0.11)), '--c-navy-600': rgb(mix(t.navy, t.accent, 0.35)),
    '--c-accent': rgb(t.accent), '--c-accent-600': rgb(mix(t.accent, '#000000', 0.22)), '--c-accent-400': rgb(mix(t.accent, '#ffffff', 0.35)), '--c-accent-100': rgb(mix(t.accent, '#ffffff', 0.88)), '--c-mist': rgb(t.mist) };
}
let fontLink: HTMLLinkElement | null = null;
export function applyTheme(themeId: string | undefined, headingFont?: string) {
  const t = THEMES.find(x => x.id === themeId) ?? THEMES[0]; const root = document.documentElement;
  for (const [k, v] of Object.entries(themeVars(t))) root.style.setProperty(k, v);
  const f = HEADING_FONTS[headingFont && HEADING_FONTS[headingFont] ? headingFont : t.font] ?? HEADING_FONTS.default;
  root.style.setProperty('--font-heading', f.css);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.navy);
  if (f.gf) { const href = `https://fonts.googleapis.com/css2?family=${f.gf}&display=swap`; if (!fontLink) { fontLink = document.createElement('link'); fontLink.rel = 'stylesheet'; document.head.appendChild(fontLink); } if (fontLink.href !== href) fontLink.href = href; }
}

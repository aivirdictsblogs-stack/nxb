export default {
  content: ['./index.html', './src/web/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: { navy: { DEFAULT: '#071426', 800: '#0b1d36', 700: '#102a4c', 600: '#17386a' }, electric: { DEFAULT: '#087BFF', 600: '#0663d1', 400: '#3d9bff', 100: '#dcecff' }, mist: '#F4F7FC' },
    fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
    boxShadow: { card: '0 1px 2px rgba(7,20,38,.06), 0 8px 24px -12px rgba(7,20,38,.18)', glow: '0 0 0 1px rgba(8,123,255,.35), 0 10px 40px -10px rgba(8,123,255,.55)' },
  } },
  plugins: [],
};

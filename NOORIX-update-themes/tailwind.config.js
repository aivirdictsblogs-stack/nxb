export default {
  content: ['./index.html', './src/web/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: {
      navy: { DEFAULT: 'rgb(var(--c-navy) / <alpha-value>)', 800: 'rgb(var(--c-navy-800) / <alpha-value>)', 700: 'rgb(var(--c-navy-700) / <alpha-value>)', 600: 'rgb(var(--c-navy-600) / <alpha-value>)' },
      electric: { DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)', 600: 'rgb(var(--c-accent-600) / <alpha-value>)', 400: 'rgb(var(--c-accent-400) / <alpha-value>)', 100: 'rgb(var(--c-accent-100) / <alpha-value>)' },
      mist: 'rgb(var(--c-mist) / <alpha-value>)',
    },
    fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
    keyframes: { floaty: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } }, fadeup: { from: { opacity: 0, transform: 'translateY(12px)' }, to: { opacity: 1, transform: 'none' } } },
    animation: { floaty: 'floaty 6s ease-in-out infinite', fadeup: 'fadeup .5s ease both' },
    boxShadow: { card: '0 1px 2px rgba(7,20,38,.06), 0 8px 24px -12px rgba(7,20,38,.18)', glow: '0 0 0 1px rgb(var(--c-accent) / .35), 0 10px 40px -10px rgb(var(--c-accent) / .55)' },
  } },
  plugins: [],
};

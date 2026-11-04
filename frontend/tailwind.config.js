import colors from 'tailwindcss/colors';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      fontSize: { xs: ['0.75rem', '1.05rem'], sm: ['0.8125rem', '1.25rem'] },
      colors: {
        // Black-and-white identity on a cool, slightly blue-tinted neutral scale; `accent` is the one restrained highlight colour.
        neutral: colors.slate,
        ink: '#0b0d12',
        surface: '#eef0f5',
        accent: { 50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8' },
      },
      // Generous radii: controls 12px, cards 24px, dialogs 28px.
      borderRadius: { md: '0.75rem', lg: '1rem', xl: '1.25rem', '2xl': '1.5rem', '3xl': '1.75rem' },
      boxShadow: {
        // Soft, layered "floating" surfaces.
        card: '0 1px 1px rgba(15, 23, 42, 0.03), 0 2px 4px rgba(15, 23, 42, 0.03), 0 12px 28px -10px rgba(15, 23, 42, 0.10)',
        hover: '0 2px 4px rgba(15, 23, 42, 0.04), 0 18px 40px -12px rgba(15, 23, 42, 0.20)',
        float: '0 24px 60px -18px rgba(8, 10, 20, 0.55), 0 6px 18px rgba(8, 10, 20, 0.18)',
        glow: '0 10px 30px -8px rgba(37, 99, 235, 0.45)',
        pop: '0 20px 48px -12px rgba(15, 23, 42, 0.28), 0 4px 12px rgba(15, 23, 42, 0.08)',
        lg: '0 14px 36px -10px rgba(15, 23, 42, 0.22), 0 3px 8px rgba(15, 23, 42, 0.06)',
        xl: '0 32px 72px -16px rgba(15, 23, 42, 0.42), 0 6px 16px rgba(15, 23, 42, 0.10)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': { from: { opacity: '0', transform: 'translateY(6px) scale(0.98)' }, to: { opacity: '1', transform: 'none' } },
        rise: { from: { opacity: '0', transform: 'translateY(10px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: {
        'fade-in': 'fade-in 140ms ease-out',
        'pop-in': 'pop-in 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        rise: 'rise 420ms cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
};

import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

const config: Config = {
  // Mevcut tema sistemi [data-theme="dark"|"light"] attribute'u kullaniyor (class degil).
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '2rem', screens: { '2xl': '1400px' } },
    extend: {
      // Renkler DOGRUDAN mevcut "Obsidian & Champagne" token'larina baglanir (gercek renk degerleri).
      // Ayri HSL token kullanilmaz; light/dark otomatik olarak [data-theme] token'larindan gelir.
      colors: {
        border: 'var(--border)',
        input: 'var(--border)',
        ring: 'var(--brand)',
        background: 'var(--bg-0)',
        foreground: 'var(--text)',
        primary: { DEFAULT: 'var(--brand)', foreground: 'var(--on-gold)' },
        secondary: { DEFAULT: 'var(--panel-2)', foreground: 'var(--text)' },
        destructive: { DEFAULT: 'var(--rose)', foreground: '#ffffff' },
        success: { DEFAULT: 'var(--emerald)', foreground: '#03130d' },
        muted: { DEFAULT: 'var(--panel-2)', foreground: 'var(--muted)' },
        accent: { DEFAULT: 'var(--panel-2)', foreground: 'var(--text)' },
        popover: { DEFAULT: 'var(--panel-solid)', foreground: 'var(--text)' },
        card: { DEFAULT: 'var(--panel)', foreground: 'var(--text)' },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 4px)',
        sm: 'calc(var(--radius) - 8px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'ui-sans-serif', 'sans-serif'],
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  // Mevcut elle-yazilmis globals.css ile cakismasin diye Tailwind preflight (reset) KAPALI.
  corePlugins: { preflight: false },
  plugins: [tailwindcssAnimate],
};

export default config;

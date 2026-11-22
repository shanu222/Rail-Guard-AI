import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#0F1B2D', 800: '#16263D', 700: '#1E3350', 600: '#2A4468' },
        accent: { DEFAULT: '#E8643A', dark: '#C94F28' },
        teal: { DEFAULT: '#1FA88A', dark: '#17806A' },
        risk: { 1: '#2E9E5B', 2: '#8CC63F', 3: '#F2B01E', 4: '#E8643A', 5: '#D62839' },
        panel: '#F5F7FA',
        line: '#DDE3EB',
        ink: { DEFAULT: '#14202F', soft: '#4A586B' },
      },
      fontFamily: { sans: ['var(--font-inter)', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;

import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0d0e16',
          card: '#13151f',
          hover: '#1a1d2e',
          input: '#1e2133',
        },
        border: {
          DEFAULT: '#252840',
          light: '#2e3250',
        },
        up: {
          DEFAULT: '#10b981',
          dim: '#064e3b',
          text: '#34d399',
        },
        down: {
          DEFAULT: '#ef4444',
          dim: '#7f1d1d',
          text: '#f87171',
        },
        accent: {
          DEFAULT: '#6366f1',
          light: '#818cf8',
        },
        gold: '#f59e0b',
        hot: '#ff6b35',
      },
      fontFamily: {
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
export default config;

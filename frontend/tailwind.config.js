/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './frontend/app/**/*.{js,ts,jsx,tsx,mdx}',
    './frontend/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#090D16',
        surface: {
          DEFAULT: '#111726',
          raised: '#172033',
          border: '#1E293B',
          hover: '#1E2A42',
        },
        tactical: {
          danger: '#FF334B',
          warning: '#FF8800',
          caution: '#FFCC00',
          success: '#00E676',
          info: '#00B0FF',
          accent: '#7C4DFF',
        },
        sensor: {
          modis: '#8B5CF6',     // Purple for MODIS 1km
          viirs: '#06B6D4',     // Cyan for VIIRS 375m
          harmonized: '#F43F5E',// Crimson for unified clusters
        }
      },
      boxShadow: {
        'glow-danger': '0 0 20px -3px rgba(255, 51, 75, 0.45)',
        'glow-warning': '0 0 20px -3px rgba(255, 136, 0, 0.4)',
        'glow-cyan': '0 0 20px -3px rgba(6, 182, 212, 0.4)',
        'glow-success': '0 0 20px -3px rgba(0, 230, 118, 0.35)',
      },
      animation: {
        'ping-slow': 'ping 2.5s cubic-bezier(0, 0, 0.2, 1) infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        'pulse-glow': {
          '0%': { opacity: '0.6', transform: 'scale(0.98)' },
          '100%': { opacity: '1', transform: 'scale(1.02)' },
        }
      }
    },
  },
  plugins: [],
};


/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.15s ease-out',
        'fade-up': 'fadeUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'float': 'float 7s ease-in-out infinite',
        'shimmer': 'shimmer 2.5s linear infinite',
        'pulse-soft': 'pulseSoft 2.4s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
      },
      boxShadow: {
        'soft': '0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06)',
        'elevated': '0 4px 14px -2px rgba(15,23,42,0.08), 0 2px 6px -2px rgba(15,23,42,0.05)',
        'lifted': '0 14px 32px -10px rgba(15,23,42,0.18), 0 6px 14px -8px rgba(15,23,42,0.10)',
        'glow-brand': '0 10px 30px -8px rgba(79,70,229,0.40)',
        'glow-teal': '0 10px 30px -8px rgba(20,184,166,0.40)',
      },
      backgroundImage: {
        'brand': 'linear-gradient(135deg, #14b8a6 0%, #4f46e5 100%)',
        'brand-vivid': 'linear-gradient(135deg, #2dd4bf 0%, #6366f1 55%, #4f46e5 100%)',
        'brand-soft': 'linear-gradient(135deg, rgba(20,184,166,0.12) 0%, rgba(79,70,229,0.12) 100%)',
        'sidebar': 'linear-gradient(180deg, #0f0e2e 0%, #0b1022 60%, #0a0f1f 100%)',
        'mesh': 'radial-gradient(900px 420px at 12% -8%, rgba(45,212,191,0.10), transparent 60%), radial-gradient(820px 460px at 100% 0%, rgba(99,102,241,0.12), transparent 55%)',
        'hero': 'radial-gradient(1100px 520px at 8% -20%, rgba(45,212,191,0.16), transparent 60%), radial-gradient(900px 520px at 100% -10%, rgba(99,102,241,0.18), transparent 55%), linear-gradient(180deg, #0c1024 0%, #0f0e2e 100%)',
      },
      colors: {
        navy: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#1e1b4b',
          900: '#0f0e2e',
          950: '#07061a',
        },
        teal: {
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
        },
      },
    },
  },
  plugins: [],
}

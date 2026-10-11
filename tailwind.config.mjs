/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,ts}'],
  theme: {
    extend: {
      colors: {
        lcd: { bg: '#9aa763', ink: '#232a12', dim: '#5a6335' },
        nokiablue: { face: '#33507e', dark: '#243c61' },
        nokkey: { DEFAULT: '#d4d9e2', dark: '#a9b1c0' },
        accent: '#febb02',
      },
      fontFamily: {
        nokia: ['Verdana', 'Geneva', 'sans-serif'],
        lcd: ['"Courier New"', 'monospace'],
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        claro: {
          red: "#DA091C",
          dark: "#1A1A1A",
        },
      },
    },
  },
  plugins: [],
};

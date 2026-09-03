/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Manual de aplicação de marcas Claro — 1.2 Tipografia: "Para as
        // mídias digitais/web, deverá ser utilizada a tipografia Arial em
        // suas variações Regular e Bold."
        sans: ["Arial", "Helvetica Neue", "Helvetica", "system-ui", "sans-serif"],
      },
      colors: {
        // Manual de aplicação de marcas Claro — 1.1 Cores (paleta oficial).
        claro: {
          red: "#D52B1E", // Vermelho-Claro — Pantone 485 C
          "red-dark": "#A81E14", // passo mais escuro do vermelho, para hover/pressed
          "red-light": "#FBEAE8", // tint muito claro do vermelho, para fundos/realces
          black: "#000000",
          gray: "#ADAFAF", // Cinza-Claro
          "gray-light": "#F4F4F3",
        },
        // Paleta de status (semântica de urgência do painel do atendente) —
        // fixa e nunca reaproveitada como cor de série categórica.
        status: {
          good: "#0ca30c",
          warning: "#fab219",
          serious: "#ec835a",
          critical: "#d03b3b",
        },
        // Paleta categórica (identidade — ex.: canal de origem), ordem fixa.
        cat: {
          1: "#2a78d6",
          2: "#eb6834",
          3: "#1baf7a",
          4: "#eda100",
        },
      },
    },
  },
  plugins: [],
};

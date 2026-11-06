const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    // Scopes a theme stylesheet under html[data-theme="<slug>"]; it only acts on themes/<slug>/src/styles/ files.
    "./postcss/scope-theme.cjs": {},
  },
};

export default config;
/* @theme-integration-patch:postcss */

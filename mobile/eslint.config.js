// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
    rules: {
      // Les textes français utilisent des apostrophes typographiques dans le
      // JSX ; l'échappement systématique nuit à la lisibilité.
      "react/no-unescaped-entities": "off",
      // Les écrans chargent leurs données dans useEffect (fetch → setState) :
      // c'est le pattern standard de cette base de code (hérité de voizin).
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
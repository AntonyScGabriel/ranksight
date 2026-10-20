import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.expo/**",
      "**/.turbo/**",
      "**/storage/**",
      "apps/api/src/generated/**",
      "**/next-env.d.ts",
      "**/expo-env.d.ts",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports", disallowTypeAnnotations: false }],
    },
  },
  // API, scripts et package partagé : environnement Node
  {
    files: ["apps/api/**/*.ts", "packages/**/*.ts", "scripts/**/*.mjs", "**/*.config.{ts,mjs,js}", "apps/web/e2e/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  // NestJS : l'injection de dépendances lit les types des constructeurs à l'exécution,
  // un import de type supprimerait la classe injectée.
  {
    files: ["apps/api/**/*.ts"],
    rules: { "@typescript-eslint/consistent-type-imports": "off" },
  },
  // Interfaces React (web, administration, mobile)
  {
    files: ["apps/web/**/*.{ts,tsx}", "apps/admin/**/*.{ts,tsx}", "apps/mobile/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: { ...reactHooks.configs.recommended.rules },
  },
);

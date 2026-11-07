import parser from "@typescript-eslint/parser";
import ts from "@typescript-eslint/eslint-plugin";

export default [
  { ignores: ["node_modules/**", "**/contracts/*.generated.ts"] },
  { files: ["**/*.ts"], languageOptions: { parser, parserOptions: { ecmaVersion: "latest", sourceType: "module" } },
    plugins: { "@typescript-eslint": ts },
    rules: { ...ts.configs.recommended.rules, "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] } },
];

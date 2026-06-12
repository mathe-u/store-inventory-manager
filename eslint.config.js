// eslint.config.js
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            parserOptions: {
                project: "./tsconfig.json",
            },
        },
        rules: {
            // Você pode customizar suas regras aqui
            "@typescript-eslint/no-explicit-any": "warn", // Avisa se usar 'any'
            "no-console": "off" // Permite console.log já que é uma API/Script Node
        },
    },
    {
        // Ignora pastas geradas automaticamente
        ignores: ["dist/", "node_modules/", "prisma/", "src/generated/"]
    }
);
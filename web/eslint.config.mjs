import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // This project intentionally uses plain <img> instead of next/image
      // to avoid coupling the frontend to Next.js-specific image optimization.
      "@next/next/no-img-element": "off",
      // Flags the standard next-themes "mounted" hydration-guard pattern
      // (and trips on shadcn's own generated carousel.tsx) as an error.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;

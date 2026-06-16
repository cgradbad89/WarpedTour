// Test-only ESM resolution hook (PRD §10 testing notes).
//
// The app's TypeScript uses idiomatic Next-style imports — extensionless
// relative specifiers ("./csv") and the "@/…" path alias — which Next's bundler
// resolves but Node's native TS runner does not. Rather than litter the source
// with ".ts" extensions just for tests, this hook teaches `node --test` the same
// two rules:
//   • "@/x"  → <repo>/src/x.ts
//   • "./x"  → <dir>/x.ts   (when x has no extension and x.ts exists)
//
// Registered via tests/register.mjs (`node --import ./tests/register.mjs`). It is
// NOT shipped in the app bundle and never runs at app runtime.

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

export async function resolve(specifier, context, nextResolve) {
  let target = null;
  if (specifier.startsWith("@/")) {
    target = path.resolve(SRC, specifier.slice(2));
  } else if (
    specifier.startsWith(".") &&
    context.parentURL &&
    !path.extname(specifier)
  ) {
    target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (target) {
    for (const candidate of [target + ".ts", path.join(target, "index.ts")]) {
      if (existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}

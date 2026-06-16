// Registers the test-only TypeScript resolution hook (see ts-resolve.mjs).
// Used by the `test` npm script: `node --import ./tests/register.mjs --test …`.
import { register } from "node:module";

register("./ts-resolve.mjs", import.meta.url);

import { rm } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const targets = [".next", "tsconfig.tsbuildinfo"];

for (const target of targets) {
  await rm(join(root, target), { force: true, recursive: true });
}

console.log("Next.js development cache cleaned.");

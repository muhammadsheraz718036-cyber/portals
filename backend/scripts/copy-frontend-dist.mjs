import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, "..");
const frontendDist = resolve(backendRoot, "../frontend/dist");
const targetDir = resolve(backendRoot, "dist/public");

if (!existsSync(frontendDist)) {
  console.error(`Frontend build output not found at ${frontendDist}.`);
  process.exit(1);
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });
cpSync(frontendDist, targetDir, { recursive: true });

console.log(`Copied frontend build to ${targetDir}`);

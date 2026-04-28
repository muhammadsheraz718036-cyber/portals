import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, "..");
const pm2Home = resolve(backendRoot, ".pm2");

mkdirSync(pm2Home, { recursive: true });

const command =
  process.platform === "win32" ? "cmd.exe" : "npx";
const args =
  process.platform === "win32"
    ? ["/d", "/s", "/c", "npx.cmd pm2 " + process.argv.slice(2).join(" ")]
    : ["pm2", ...process.argv.slice(2)];

const child = spawn(command, args, {
  cwd: backendRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    PM2_HOME: pm2Home,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

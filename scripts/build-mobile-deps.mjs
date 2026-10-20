import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const result = spawnSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "build", "--workspace=@ranksight/shared"],
  {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32"
  }
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);

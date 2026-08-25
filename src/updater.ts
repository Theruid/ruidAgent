import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execAsync = promisify(exec);

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  packageName: string;
}

/**
 * Reads local package.json to get current version and package name.
 */
export function getLocalPackageInfo(): { name: string; version: string } {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(__dirname, "../../package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      return { name: pkg.name || "@theruid/ruid", version: pkg.version || "0.1.0" };
    }
  } catch {
    // Fallback
  }
  return { name: "@theruid/ruid", version: "0.1.0" };
}

/**
 * Compares two semver strings (v1 > v2).
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const cParts = current.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const lParts = latest.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);

  for (let i = 0; i < Math.max(cParts.length, lParts.length); i++) {
    const c = cParts[i] ?? 0;
    const l = lParts[i] ?? 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

/**
 * Checks the npm registry for the latest published version.
 * Times out quickly (2 seconds) so it never hangs app startup.
 */
export async function checkForUpdate(timeoutMs = 2000): Promise<UpdateInfo | null> {
  const { name, version: currentVersion } = getLocalPackageInfo();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const data: any = await res.json();
    const latestVersion = data?.version;
    if (!latestVersion || typeof latestVersion !== "string") return null;

    const hasUpdate = isNewerVersion(currentVersion, latestVersion);
    return {
      packageName: name,
      currentVersion,
      latestVersion,
      hasUpdate,
    };
  } catch {
    return null; // Network offline or registry timeout — fail silently
  }
}

/**
 * Runs npm install -g to self-update the CLI.
 */
export async function performUpdate(packageName: string): Promise<{ success: boolean; output: string }> {
  try {
    const isWindows = process.platform === "win32";
    const cmd = `npm install -g ${packageName}@latest`;
    const { stdout, stderr } = await execAsync(cmd, {
      windowsHide: true,
      env: process.env,
    });
    return {
      success: true,
      output: (stdout + "\n" + stderr).trim(),
    };
  } catch (err: any) {
    return {
      success: false,
      output: err.stderr || err.message || String(err),
    };
  }
}

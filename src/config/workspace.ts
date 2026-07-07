import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * The `.orgit/` workspace inside the target repository. Holds the vector memory,
 * generated reports, learned conventions, and the health history. It is git-ignored
 * by convention; the first run creates it.
 */
export interface Workspace {
  /** Absolute path to the target repository root. */
  root: string;
  /** Absolute path to `.orgit/`. */
  dir: string;
  /** Absolute path to the LanceDB directory. */
  memoryDir: string;
  /** Absolute path to the reports directory. */
  reportsDir: string;
  /** Absolute path to the learned-conventions file. */
  conventionsFile: string;
  /** Absolute path to the health-history file. */
  historyFile: string;
  /** Absolute path to the active mission file (the persistent refactoring goal). */
  missionFile: string;
  /** Absolute path to the cross-run decision memory (what Orgit has already done). */
  decisionsFile: string;
}

export const WORKSPACE_DIRNAME = ".orgit";

export function resolveWorkspace(root: string): Workspace {
  const dir = path.join(root, WORKSPACE_DIRNAME);
  return {
    root,
    dir,
    memoryDir: path.join(dir, "memory"),
    reportsDir: path.join(dir, "reports"),
    conventionsFile: path.join(dir, "conventions.json"),
    historyFile: path.join(dir, "history.json"),
    missionFile: path.join(dir, "mission.json"),
    decisionsFile: path.join(dir, "decisions.json"),
  };
}

/** Create the workspace directory tree if missing. Idempotent. */
export async function ensureWorkspace(root: string): Promise<Workspace> {
  const ws = resolveWorkspace(root);
  await fs.mkdir(ws.memoryDir, { recursive: true });
  await fs.mkdir(ws.reportsDir, { recursive: true });
  // Drop a .gitignore inside .orgit so it is never accidentally committed even if
  // the repo's root .gitignore does not mention it.
  await fs.writeFile(path.join(ws.dir, ".gitignore"), "*\n", "utf8").catch(() => {});
  return ws;
}

/** Whether the workspace already exists on disk. */
export async function workspaceExists(root: string): Promise<boolean> {
  const ws = resolveWorkspace(root);
  try {
    const stat = await fs.stat(ws.dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

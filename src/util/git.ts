import { simpleGit, type SimpleGit } from "simple-git";

/**
 * Thin git wrapper. Orgit is git-native: every change is a commit on a branch and
 * every change must be reversible (design spec → "Small changes", "Reversible").
 * This module centralises the operations the executor relies on for safe, atomic tasks.
 */
export class Git {
  private readonly git: SimpleGit;

  constructor(public readonly root: string) {
    this.git = simpleGit(root);
  }

  async isRepo(): Promise<boolean> {
    try {
      return await this.git.checkIsRepo();
    } catch {
      return false;
    }
  }

  /** True when there are no uncommitted changes. */
  async isClean(): Promise<boolean> {
    const status = await this.git.status();
    return status.isClean();
  }

  async currentBranch(): Promise<string> {
    return (await this.git.revparse(["--abbrev-ref", "HEAD"])).trim();
  }

  async headSha(): Promise<string> {
    return (await this.git.revparse(["HEAD"])).trim();
  }

  async createBranch(name: string, from?: string): Promise<void> {
    if (from) await this.git.checkoutBranch(name, from);
    else await this.git.checkoutLocalBranch(name);
  }

  async checkout(ref: string): Promise<void> {
    await this.git.checkout(ref);
  }

  async stageAll(): Promise<void> {
    await this.git.add(["-A"]);
  }

  /** Stage a specific set of paths (used to commit generated tests on their own). */
  async addFiles(paths: string[]): Promise<void> {
    if (paths.length > 0) await this.git.add(paths);
  }

  async commit(message: string): Promise<string> {
    const res = await this.git.commit(message);
    return res.commit;
  }

  /** Hard-reset the working tree back to a known-good ref. The rollback primitive. */
  async resetHard(ref: string): Promise<void> {
    await this.git.reset(["--hard", ref]);
  }

  async cleanUntracked(): Promise<void> {
    await this.git.clean("f", ["-d"]);
  }

  /** Restore the tree to `ref`, discarding everything since (used on validation failure). */
  async rollbackTo(ref: string): Promise<void> {
    await this.resetHard(ref);
    await this.cleanUntracked();
  }

  async diffStat(): Promise<string> {
    return this.git.diff(["--stat"]);
  }

  // --- Worktree & cherry-pick primitives (used for genuinely-parallel step execution) ---

  /** Add a detached worktree at the current HEAD in `dir` (an isolated working tree). */
  async addWorktree(dir: string): Promise<void> {
    await this.git.raw(["worktree", "add", "--detach", dir, "HEAD"]);
  }

  /** Remove a worktree previously added with `addWorktree`. */
  async removeWorktree(dir: string): Promise<void> {
    await this.git.raw(["worktree", "remove", "--force", dir]);
  }

  /** Cherry-pick a commit (created in a worktree) onto the current branch. */
  async cherryPick(sha: string): Promise<void> {
    await this.git.raw(["cherry-pick", sha]);
  }

  async cherryPickAbort(): Promise<void> {
    await this.git.raw(["cherry-pick", "--abort"]);
  }
}

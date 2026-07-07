import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import type { ClaudeProvider, CompleteOptions } from "../src/providers/types.js";
import type { Retriever } from "../src/memory/retriever.js";

/** A disposable git repo seeded with the given files, committed as "init". */
export interface TempRepo {
  root: string;
  cleanup: () => Promise<void>;
}

export async function makeTempGitRepo(files: Record<string, string>): Promise<TempRepo> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-e2e-"));
  const git = simpleGit(root);
  await git.init();
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("user.name", "Orgit Test");
  await git.addConfig("commit.gpgsign", "false");
  await git.addConfig("core.autocrlf", "false");

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
  }
  await git.add(["-A"]);
  await git.commit("init");

  return { root, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

/**
 * A deterministic stand-in for a Claude backend. `handler` receives each request and
 * returns the raw text the model would produce, so tests can drive detection and
 * execution without a network call or a real model.
 */
export class FakeProvider implements ClaudeProvider {
  readonly kind = "cli" as const;
  public calls: CompleteOptions[] = [];

  constructor(private readonly handler: (opts: CompleteOptions) => string) {}

  describe(): string {
    return "FakeProvider";
  }
  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: "fake" };
  }
  async complete(opts: CompleteOptions): Promise<string> {
    this.calls.push(opts);
    return this.handler(opts);
  }
}

/** A retriever that returns nothing — lets engine tests run fully offline (no embeddings). */
export const emptyRetriever = {
  retrieve: async () => [],
} as unknown as Retriever;

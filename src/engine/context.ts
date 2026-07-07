import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { loadConfig, type OrgitConfig } from "../config/config.js";
import { ensureWorkspace, type Workspace } from "../config/workspace.js";
import { createProvider } from "../providers/factory.js";
import type { ClaudeProvider } from "../providers/types.js";
import { Embeddings } from "../memory/embeddings.js";
import { MemoryStore } from "../memory/store.js";
import { Indexer } from "../memory/indexer.js";
import { Retriever } from "../memory/retriever.js";
import { Git } from "../util/git.js";

/**
 * The assembled runtime an Orgit command operates within. Building it once and
 * passing it to the engine keeps every command's setup identical and testable.
 */
export interface RunContext {
  root: string;
  config: OrgitConfig;
  workspace: Workspace;
  provider: ClaudeProvider;
  store: MemoryStore;
  embeddings: Embeddings;
  indexer: Indexer;
  retriever: Retriever;
  git: Git;
}

export interface BuildContextOptions {
  /** If true, do not create a Claude provider (used by memory-only / doctor paths). */
  withoutProvider?: boolean;
}

export async function buildContext(
  root: string,
  opts: BuildContextOptions = {},
): Promise<RunContext> {
  const config = await loadConfig(root);
  const workspace = await ensureWorkspace(root);

  // Cache the embedding model in a shared, user-level directory so it downloads once
  // across all repositories Orgit is run on — not once per project. Overridable via
  // ORGIT_CACHE_DIR.
  const cacheDir = process.env.ORGIT_CACHE_DIR ?? path.join(os.homedir(), ".orgit-cache", "models");
  await fs.mkdir(cacheDir, { recursive: true });
  const embeddings = new Embeddings(config.embeddingModel, cacheDir);
  const store = new MemoryStore(workspace.memoryDir);
  await store.open();
  const indexer = new Indexer(store, embeddings, config);
  const retriever = new Retriever(store, embeddings);
  const git = new Git(root);

  const provider = opts.withoutProvider
    ? (undefined as unknown as ClaudeProvider)
    : await createProvider(config);

  return { root, config, workspace, provider, store, embeddings, indexer, retriever, git };
}

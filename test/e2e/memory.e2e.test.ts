import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/config.js";
import { buildMentalModel } from "../../src/analysis/model.js";
import { Embeddings } from "../../src/memory/embeddings.js";
import { MemoryStore } from "../../src/memory/store.js";
import { Indexer } from "../../src/memory/indexer.js";
import { Retriever } from "../../src/memory/retriever.js";
import { makeTempGitRepo, type TempRepo } from "../helpers.js";

/**
 * Real memory pipeline: local embeddings (fastembed/ONNX) + LanceDB + incremental
 * indexing + retrieval. Opt-in because the first run downloads the embedding model.
 * Enable with: ORGIT_E2E=1 pnpm test
 */
const enabled = !!process.env.ORGIT_E2E;

let repo: TempRepo | undefined;
let cacheDir: string | undefined;
afterEach(async () => {
  await repo?.cleanup();
  repo = undefined;
});

describe.runIf(enabled)("memory pipeline e2e (real embeddings + LanceDB)", () => {
  it("indexes, retrieves relevant chunks, and re-indexes incrementally", async () => {
    repo = await makeTempGitRepo({
      "src/math.js": "function add(a, b) { return a + b; }\nmodule.exports = { add };\n",
      "src/http.js":
        "async function fetchUser(id) { return await get(`/users/${id}`); }\nmodule.exports = { fetchUser };\n",
    });
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "orgit-emb-"));

    const embeddings = new Embeddings(DEFAULT_CONFIG.embeddingModel, cacheDir);
    const store = new MemoryStore(path.join(repo.root, ".orgit", "memory"));
    await store.open();
    const indexer = new Indexer(store, embeddings, DEFAULT_CONFIG);
    const retriever = new Retriever(store, embeddings);

    // First index: both files embedded.
    const model = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const first = await indexer.sync(model);
    expect(first.added).toBe(2);
    expect(first.chunks).toBeGreaterThan(0);
    expect(await store.countRows()).toBeGreaterThan(0);

    // Retrieval returns the semantically closest file first.
    const hits = await retriever.retrieve("adding two numbers together", 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.path).toBe("src/math.js");

    // Touch one file → only that file re-embeds.
    await fs.appendFile(path.join(repo.root, "src/math.js"), "\n// changed\n");
    const model2 = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const second = await indexer.sync(model2);
    expect(second.changed).toBe(1);
    expect(second.unchanged).toBe(1);
    expect(second.added).toBe(0);

    // Remove a file → its chunks are purged.
    await fs.rm(path.join(repo.root, "src/http.js"));
    const model3 = await buildMentalModel(repo.root, DEFAULT_CONFIG);
    const third = await indexer.sync(model3);
    expect(third.removed).toBe(1);

    await fs.rm(cacheDir, { recursive: true, force: true });
  }, 180_000);
});

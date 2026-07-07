import { FlagEmbedding, EmbeddingModel } from "fastembed";

/**
 * Local embeddings via fastembed (ONNX). No API key, no network at inference time,
 * no per-token cost — this is what lets Orgit's memory work in subscription-only mode
 * and keeps refactoring from re-sending whole files to Claude on every iteration.
 *
 * The model is downloaded once to a cache dir and reused.
 */
export class Embeddings {
  private model?: FlagEmbedding;

  constructor(
    private readonly modelName: string,
    private readonly cacheDir: string,
  ) {}

  /** Dimensionality of the configured model (needed to declare the vector column). */
  static dimensionOf(modelName: string): number {
    switch (resolveModel(modelName)) {
      case EmbeddingModel.BGESmallENV15:
        return 384;
      case EmbeddingModel.BGEBaseENV15:
        return 768;
      default:
        return 384;
    }
  }

  private async ready(): Promise<FlagEmbedding> {
    if (!this.model) {
      try {
        this.model = await FlagEmbedding.init({
          model: resolveModel(this.modelName),
          cacheDir: this.cacheDir,
        });
      } catch (err) {
        throw new Error(
          `Failed to initialise the local embedding model "${this.modelName}". ` +
            `The first run downloads it and needs network access; check connectivity or configure a different ` +
            `"embeddingModel" in orgit.config.json. Cause: ${(err as Error).message}`,
        );
      }
    }
    return this.model;
  }

  /** Embed documents (for indexing). Returns one vector per input, in order. */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const model = await this.ready();
    const out: number[][] = [];
    for await (const batch of model.embed(texts, 64)) {
      for (const v of batch) out.push(Array.from(v));
    }
    return out;
  }

  /** Embed a single query (for retrieval). */
  async embedQuery(text: string): Promise<number[]> {
    const model = await this.ready();
    const v = await model.queryEmbed(text);
    return Array.from(v);
  }
}

function resolveModel(name: string): EmbeddingModel {
  const n = name.toLowerCase();
  if (n.includes("bge-base")) return EmbeddingModel.BGEBaseENV15;
  if (n.includes("bge-small")) return EmbeddingModel.BGESmallENV15;
  return EmbeddingModel.BGESmallENV15;
}

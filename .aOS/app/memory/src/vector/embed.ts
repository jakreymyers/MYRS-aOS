import { getLlama, resolveModelFile, LlamaLogLevel } from 'node-llama-cpp';
import type { Llama, LlamaModel, LlamaEmbeddingContext } from 'node-llama-cpp';

const MODEL_URI = 'hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf';

// Format text the same way QMD does for cross-compatibility
export const formatDocumentText = (title: string, content: string): string =>
  `title: ${title} | text: ${content}`;

export const formatQueryText = (query: string): string =>
  `task: search result | query: ${query}`;

let instance: Embedder | null = null;

export class Embedder {
  private llama: Llama;
  private model: LlamaModel;
  private ctx: LlamaEmbeddingContext;

  private constructor(llama: Llama, model: LlamaModel, ctx: LlamaEmbeddingContext) {
    this.llama = llama;
    this.model = model;
    this.ctx = ctx;
  }

  static async create(): Promise<Embedder> {
    const llama = await getLlama({ logLevel: LlamaLogLevel.error });
    const modelPath = await resolveModelFile(MODEL_URI, { cli: false });
    const model = await llama.loadModel({ modelPath });
    const ctx = await model.createEmbeddingContext();
    return new Embedder(llama, model, ctx);
  }

  async embed(text: string): Promise<Float32Array> {
    const result = await this.ctx.getEmbeddingFor(text);
    return new Float32Array(result.vector);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
    await this.model.dispose();
    await this.llama.dispose();
    if (instance === this) instance = null;
  }
}

/**
 * Get or create the singleton embedder.
 * Lazy initialization — model loads on first call (~1-2s).
 */
export const getEmbedder = async (): Promise<Embedder> => {
  if (!instance) {
    instance = await Embedder.create();
  }
  return instance;
};

/**
 * Dispose the singleton embedder, freeing model memory.
 */
export const disposeEmbedder = async (): Promise<void> => {
  if (instance) {
    await instance.dispose();
    instance = null;
  }
};

import type { Source } from "./source.js";

/** Holds the registered sources, keyed by their sourceType. */
export class SourceRegistry {
  private readonly sources = new Map<string, Source>();

  register(source: Source): void {
    if (this.sources.has(source.sourceType)) {
      throw new Error(`duplicate source type: ${source.sourceType}`);
    }
    this.sources.set(source.sourceType, source);
  }

  get(sourceType: string): Source | undefined {
    return this.sources.get(sourceType);
  }

  has(sourceType: string): boolean {
    return this.sources.has(sourceType);
  }

  list(): string[] {
    return [...this.sources.keys()];
  }
}

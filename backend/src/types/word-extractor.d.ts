declare module "word-extractor" {
  class WordExtractor {
    extract(input: string | Buffer): Promise<{
      getBody(): string;
      getFootnotes(): string;
      getEndnotes(): string;
      getHeaders(options?: unknown): string;
    }>;
  }

  export default WordExtractor;
}

/**
 * Block chunker for streaming output.
 * Implements min/max bounds with break preference for splitting text.
 *
 * - Low bound: don't emit until buffer >= minChars (unless forced)
 * - High bound: prefer splits before maxChars; if forced, split at maxChars
 * - Break preference: paragraph → newline → sentence → whitespace → hard break
 */

export type BlockChunkingConfig = {
  minChars: number;
  maxChars: number;
};

type BreakPoint = {
  index: number;
  priority: number;
};

export class EmbeddedBlockChunker {
  private buffer = "";
  private readonly minChars: number;
  private readonly maxChars: number;

  constructor(config: BlockChunkingConfig) {
    this.minChars = config.minChars;
    this.maxChars = config.maxChars;
  }

  /**
   * Add text to the buffer and return any chunks ready to emit.
   */
  push(text: string): string[] {
    this.buffer += text;
    const chunks: string[] = [];

    while (this.buffer.length >= this.minChars) {
      const chunk = this.extractChunk();
      if (!chunk) break;
      chunks.push(chunk);
    }

    return chunks;
  }

  /**
   * Force flush any remaining buffer content.
   */
  flush(): string | undefined {
    if (this.buffer.length === 0) return undefined;
    const chunk = this.buffer;
    this.buffer = "";
    return chunk;
  }

  /**
   * Get current buffer content without modifying it.
   */
  peek(): string {
    return this.buffer;
  }

  private extractChunk(): string | undefined {
    if (this.buffer.length < this.minChars) return undefined;

    // If we're under maxChars and haven't hit a good break point, wait
    if (this.buffer.length < this.maxChars) {
      const breakPoint = this.findBreakPoint(this.buffer, this.buffer.length);
      if (!breakPoint || breakPoint.index < this.minChars) return undefined;
      const chunk = this.buffer.slice(0, breakPoint.index);
      this.buffer = this.buffer.slice(breakPoint.index).trimStart();
      return chunk;
    }

    // We've exceeded maxChars, must split
    const breakPoint = this.findBreakPoint(this.buffer, this.maxChars);
    const splitIndex = breakPoint?.index ?? this.maxChars;
    const chunk = this.buffer.slice(0, splitIndex);
    this.buffer = this.buffer.slice(splitIndex).trimStart();
    return chunk;
  }

  private findBreakPoint(
    text: string,
    maxIndex: number,
  ): BreakPoint | undefined {
    const candidates: BreakPoint[] = [];

    // Priority 1: Paragraph break (double newline)
    const paragraphMatch = text.slice(0, maxIndex).match(/\n\n/g);
    if (paragraphMatch) {
      const _idx = 0;
      let lastPara = -1;
      for (const match of text.slice(0, maxIndex).matchAll(/\n\n/g)) {
        if (match.index !== undefined && match.index >= this.minChars) {
          lastPara = match.index + 2;
        }
      }
      if (lastPara > 0) {
        candidates.push({ index: lastPara, priority: 1 });
      }
    }

    // Priority 2: Single newline
    const lastNewline = text.slice(0, maxIndex).lastIndexOf("\n");
    if (lastNewline >= this.minChars) {
      candidates.push({ index: lastNewline + 1, priority: 2 });
    }

    // Priority 3: Sentence end (. ! ? followed by space or newline)
    const sentenceMatch = text.slice(0, maxIndex).match(/[.!?][\s\n]/g);
    if (sentenceMatch) {
      let lastSentence = -1;
      for (const match of text.slice(0, maxIndex).matchAll(/[.!?][\s\n]/g)) {
        if (match.index !== undefined && match.index + 2 >= this.minChars) {
          lastSentence = match.index + 2;
        }
      }
      if (lastSentence > 0) {
        candidates.push({ index: lastSentence, priority: 3 });
      }
    }

    // Priority 4: Whitespace
    const lastSpace = text.slice(0, maxIndex).lastIndexOf(" ");
    if (lastSpace >= this.minChars) {
      candidates.push({ index: lastSpace + 1, priority: 4 });
    }

    // Return highest priority (lowest number) break point
    if (candidates.length === 0) return undefined;
    candidates.sort((a, b) => a.priority - b.priority);
    return candidates[0];
  }
}

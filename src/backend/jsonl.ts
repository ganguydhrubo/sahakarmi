import { StringDecoder } from "node:string_decoder";
import { isRpcMessage, type RpcMessage } from "./protocol";

/**
 * Splits a JSON-RPC stream into messages. A line that is not a JSON-RPC message (a stray log
 * line or banner) is skipped and reported through `onSkipped` instead of ending the session.
 * Without a callback it still throws, for callers that want the strict behaviour.
 */
export class JsonLineDecoder {
  readonly #decoder = new StringDecoder("utf8");
  readonly #onSkipped: ((line: string) => void) | undefined;
  #buffer = "";

  constructor(onSkipped?: (line: string) => void) {
    this.#onSkipped = onSkipped;
  }

  push(chunk: Uint8Array | string): RpcMessage[] {
    this.#buffer += typeof chunk === "string" ? chunk : this.#decoder.write(Buffer.from(chunk));
    return this.#drainCompleteLines();
  }

  end(chunk?: Uint8Array | string): RpcMessage[] {
    if (chunk) {
      this.#buffer += typeof chunk === "string" ? chunk : this.#decoder.write(Buffer.from(chunk));
    }
    this.#buffer += this.#decoder.end();

    const messages = this.#drainCompleteLines();
    const trailing = this.#buffer.trim();
    this.#buffer = "";

    if (trailing) {
      const message = this.#parseLine(trailing);
      if (message) messages.push(message);
    }

    return messages;
  }

  #drainCompleteLines(): RpcMessage[] {
    const messages: RpcMessage[] = [];
    let newlineIndex = this.#buffer.indexOf("\n");

    while (newlineIndex >= 0) {
      const line = this.#buffer.slice(0, newlineIndex).trim();
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      const message = line ? this.#parseLine(line) : null;
      if (message) messages.push(message);
      newlineIndex = this.#buffer.indexOf("\n");
    }

    return messages;
  }

  #parseLine(line: string): RpcMessage | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      if (this.#onSkipped) {
        this.#onSkipped(line.slice(0, 500));
        return null;
      }
      throw new Error(`Invalid JSONL from Codex App Server: ${String(error)}`);
    }

    if (!isRpcMessage(parsed)) {
      if (this.#onSkipped) {
        this.#onSkipped(line.slice(0, 500));
        return null;
      }
      throw new Error("Invalid JSON-RPC message from Codex App Server.");
    }

    return parsed;
  }
}

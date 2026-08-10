export interface SafeSerializeResult {
  value: unknown;
  sizeBytes: number;
  truncated: boolean;
  warnings: string[];
}

const limits = {
  maxDepth: 12,
  maxArrayItems: 1000,
  maxObjectKeys: 1000,
  maxStringLength: 100000,
  maxBinaryPreviewBytes: 256
};

export function safeSerialize(input: unknown): SafeSerializeResult {
  const seen = new WeakSet<object>();
  const warnings: string[] = [];
  let truncated = false;

  function mark(message: string): void {
    truncated = true;
    warnings.push(message);
  }

  function convert(value: unknown, depth: number): unknown {
    if (depth > limits.maxDepth) {
      mark(`Max depth exceeded at ${limits.maxDepth}`);
      return "[Truncated: max depth]";
    }

    if (typeof value === "bigint") return `${value.toString()}n`;
    if (typeof value === "function") return "[Function]";
    if (typeof value === "symbol") return "[Symbol]";
    if (typeof value === "undefined") return "[Undefined]";
    if (typeof value === "string") {
      if (value.length > limits.maxStringLength) {
        mark(`String truncated from ${value.length} characters`);
        return `${value.slice(0, limits.maxStringLength)}[Truncated]`;
      }
      return value;
    }
    if (value === null || typeof value !== "object") return value;
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) {
      return { __type: "Error", name: value.name, message: value.message, stack: value.stack };
    }
    if (value instanceof ArrayBuffer) {
      const bytes = new Uint8Array(value);
      return { __type: "ArrayBuffer", length: bytes.length, preview: [...bytes.slice(0, limits.maxBinaryPreviewBytes)] };
    }
    if (ArrayBuffer.isView(value)) {
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      return { __type: value.constructor.name, length: bytes.length, preview: [...bytes.slice(0, limits.maxBinaryPreviewBytes)] };
    }
    if (value instanceof Map) {
      return {
        __type: "Map",
        entries: [...value.entries()].slice(0, limits.maxArrayItems).map(([key, item]) => [convert(key, depth + 1), convert(item, depth + 1)])
      };
    }
    if (value instanceof Set) {
      return { __type: "Set", values: [...value.values()].slice(0, limits.maxArrayItems).map((item) => convert(item, depth + 1)) };
    }

    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (Array.isArray(value)) {
      if (value.length > limits.maxArrayItems) mark(`Array truncated from ${value.length} items`);
      return value.slice(0, limits.maxArrayItems).map((item) => convert(item, depth + 1));
    }

    const output: Record<string, unknown> = {};
    const keys = Object.keys(value);
    if (keys.length > limits.maxObjectKeys) mark(`Object keys truncated from ${keys.length}`);
    for (const key of keys.slice(0, limits.maxObjectKeys)) {
      try {
        output[key] = convert((value as Record<string, unknown>)[key], depth + 1);
      } catch (caught) {
        output[key] = `[Getter threw: ${caught instanceof Error ? caught.message : "unknown"}]`;
        warnings.push(`Getter threw at ${key}`);
      }
    }
    return output;
  }

  const value = convert(input, 0);
  const json = JSON.stringify(value);
  return { value, sizeBytes: Buffer.byteLength(json, "utf8"), truncated, warnings };
}

const secretKeys = new Set([
  "sessionid",
  "session_id",
  "cookie",
  "cookies",
  "set-cookie",
  "authorization",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "apikey",
  "api_key",
  "signature",
  "sign",
  "token",
  "password",
  "secret",
  "csrf",
  "mstoken",
  "verifyfp",
  "webid",
  "ttwid"
]);

export function redactSecrets(input: unknown): { value: unknown; redactedFields: string[] } {
  const redactedFields: string[] = [];

  function walk(value: unknown, path: string): unknown {
    if (Array.isArray(value)) return value.map((item, index) => walk(item, `${path}[${index}]`));
    if (!value || typeof value !== "object") return value;
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (secretKeys.has(key.toLowerCase())) {
        output[key] = "[REDACTED]";
        redactedFields.push(`${path}.${key}`);
      } else {
        output[key] = walk(item, `${path}.${key}`);
      }
    }
    return output;
  }

  return { value: walk(input, "$"), redactedFields };
}

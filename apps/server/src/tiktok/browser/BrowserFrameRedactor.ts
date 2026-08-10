const secretKeys = new Set([
  "cookie",
  "set-cookie",
  "authorization",
  "token",
  "sessionid",
  "session_id",
  "mstoken",
  "ttwid",
  "csrf",
  "signature",
  "sign",
  "verifyfp",
  "webid",
  "device_id",
  "access_token",
  "refresh_token"
]);

export function redactBrowserUrl(input?: string): { value?: string; redactedFields: string[] } {
  if (!input) return { value: input, redactedFields: [] };
  const redactedFields: string[] = [];
  try {
    const url = new URL(input);
    for (const key of [...url.searchParams.keys()]) {
      if (secretKeys.has(key.toLowerCase())) {
        url.searchParams.set(key, "[REDACTED]");
        redactedFields.push(`url.searchParams.${key}`);
      }
    }
    return { value: url.toString(), redactedFields };
  } catch {
    return { value: input, redactedFields };
  }
}

export function redactBrowserHeaders(headers: Record<string, unknown>): { value: Record<string, unknown>; redactedFields: string[] } {
  const redactedFields: string[] = [];
  const value: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(headers)) {
    if (secretKeys.has(key.toLowerCase())) {
      value[key] = "[REDACTED]";
      redactedFields.push(`headers.${key}`);
    } else {
      value[key] = item;
    }
  }
  return { value, redactedFields };
}

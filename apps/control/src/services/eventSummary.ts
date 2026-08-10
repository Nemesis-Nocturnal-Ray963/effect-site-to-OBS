import type { NormalizedEvent } from "@obs-effect/shared-types";

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function summarizeEvent(event: NormalizedEvent): string {
  switch (event.type) {
    case "gift": {
      const giftName = asText(event.data.giftName) ?? "Gift";
      const repeatCount = asNumber(event.data.repeatCount) ?? 1;
      const diamonds = asNumber(event.data.diamondValueTotal);
      return diamonds ? `${giftName} x${repeatCount} / ${diamonds} diamonds` : `${giftName} x${repeatCount}`;
    }
    case "comment":
      return asText(event.data.comment) ?? "Comment";
    case "like-batch": {
      const count = asNumber(event.data.likeCount) ?? asNumber(event.data.count);
      return count ? `+${count} likes` : "Likes";
    }
    case "follow":
      return "Follow";
    case "share":
      return "Share";
    case "member-join":
      return "Joined";
    default:
      return event.type;
  }
}

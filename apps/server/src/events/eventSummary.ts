import type { NormalizedEvent } from "@obs-effect/shared-types";

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function summarizeEvent(event: NormalizedEvent): string {
  switch (event.type) {
    case "gift": {
      const name = textValue(event.data.giftName) ?? "Gift";
      const count = numberValue(event.data.repeatCount) ?? 1;
      const diamonds = numberValue(event.data.diamondValueTotal);
      return diamonds ? `${name} x${count} / ${diamonds} diamonds` : `${name} x${count}`;
    }
    case "comment":
      return textValue(event.data.comment) ?? "Comment";
    case "like-batch": {
      const count = numberValue(event.data.likeCount) ?? numberValue(event.data.count);
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

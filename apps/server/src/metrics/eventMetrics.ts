import type { HttpApiMetrics } from "@obs-effect/shared-types";

export class EventMetrics {
  private metrics: HttpApiMetrics = {
    enabled: true,
    receivedCount: 0,
    duplicateCount: 0,
    validationErrorCount: 0,
    lastReceivedAt: null
  };

  markReceived(receivedAt: string): void {
    this.metrics.receivedCount += 1;
    this.metrics.lastReceivedAt = receivedAt;
  }

  markDuplicate(): void {
    this.metrics.duplicateCount += 1;
  }

  markValidationError(): void {
    this.metrics.validationErrorCount += 1;
  }

  snapshot(): HttpApiMetrics {
    return { ...this.metrics };
  }
}

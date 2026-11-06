import type { EffectPlayMessage, OverlayId } from "@obs-effect/shared-types";

interface SimpleMediaQueueJob {
  instanceId: string;
  targetOverlayId: OverlayId;
  createMessage: () => EffectPlayMessage | Promise<EffectPlayMessage>;
}

interface SimpleMediaQueueServiceOptions {
  broadcast: (overlayId: OverlayId, message: EffectPlayMessage) => void;
  fallbackTimeoutMs?: number;
}

export class SimpleMediaQueueService {
  private readonly pending: SimpleMediaQueueJob[] = [];
  private activeInstanceId: string | null = null;
  private pumping = false;
  private fallbackTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: SimpleMediaQueueServiceOptions) {}

  enqueue(job: SimpleMediaQueueJob): { instanceId: string; waitingCount: number } {
    this.pending.push(job);
    void this.pump();
    return {
      instanceId: job.instanceId,
      waitingCount: this.pending.length - (this.activeInstanceId ? 0 : 1)
    };
  }

  complete(instanceId: string): boolean {
    if (instanceId !== this.activeInstanceId) return false;
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = null;
    this.activeInstanceId = null;
    void this.pump();
    return true;
  }

  status(): { activeInstanceId: string | null; waitingCount: number } {
    return { activeInstanceId: this.activeInstanceId, waitingCount: this.pending.length };
  }

  dispose(): void {
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = null;
    this.pending.length = 0;
    this.activeInstanceId = null;
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.activeInstanceId || this.pending.length === 0) return;
    this.pumping = true;
    const job = this.pending.shift()!;
    this.activeInstanceId = job.instanceId;
    try {
      const message = await job.createMessage();
      if (this.activeInstanceId !== job.instanceId) return;
      const waitingCount = this.pending.length;
      const playbackRate = waitingCount > 10 ? 1.1 : 1;
      message.runtimeData = {
        ...message.runtimeData,
        simpleMediaQueueWaitingCount: waitingCount,
        simpleMediaPlaybackRate: playbackRate
      };
      this.options.broadcast(job.targetOverlayId, message);
      const fallbackTimeoutMs = this.options.fallbackTimeoutMs ?? 30 * 60 * 1000;
      this.fallbackTimer = setTimeout(() => this.complete(job.instanceId), fallbackTimeoutMs);
      this.fallbackTimer.unref?.();
    } catch {
      if (this.activeInstanceId === job.instanceId) this.activeInstanceId = null;
    } finally {
      this.pumping = false;
      if (!this.activeInstanceId) void this.pump();
    }
  }
}

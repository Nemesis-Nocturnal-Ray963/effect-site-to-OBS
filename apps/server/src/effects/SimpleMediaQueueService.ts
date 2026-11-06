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
  private activeDispatchedAt = 0;
  private activePlaybackRate = 1;

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
    this.activeDispatchedAt = 0;
    this.activePlaybackRate = 1;
    void this.pump();
    return true;
  }

  reportVideoDuration(instanceId: string, durationMs: number): boolean {
    if (instanceId !== this.activeInstanceId || !Number.isFinite(durationMs) || durationMs <= 0) return false;
    const expectedEndAt = this.activeDispatchedAt + durationMs / this.activePlaybackRate + 500;
    this.scheduleFallback(instanceId, Math.max(0, expectedEndAt - Date.now()));
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
    this.activeDispatchedAt = 0;
    this.activePlaybackRate = 1;
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
      this.activePlaybackRate = playbackRate;
      message.runtimeData = {
        ...message.runtimeData,
        simpleMediaQueueWaitingCount: waitingCount,
        simpleMediaPlaybackRate: playbackRate
      };
      this.activeDispatchedAt = Date.now();
      this.options.broadcast(job.targetOverlayId, message);
      this.scheduleFallback(job.instanceId, this.options.fallbackTimeoutMs ?? 30 * 60 * 1000);
    } catch {
      if (this.activeInstanceId === job.instanceId) this.activeInstanceId = null;
    } finally {
      this.pumping = false;
      if (!this.activeInstanceId) void this.pump();
    }
  }

  private scheduleFallback(instanceId: string, delayMs: number): void {
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = setTimeout(() => this.complete(instanceId), delayMs);
    this.fallbackTimer.unref?.();
  }
}

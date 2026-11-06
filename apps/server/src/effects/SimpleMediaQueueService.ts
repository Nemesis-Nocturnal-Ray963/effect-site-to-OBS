import type { EffectPlayMessage, OverlayId } from "@obs-effect/shared-types";

interface SimpleMediaQueueJob {
  instanceId: string;
  targetOverlayId: OverlayId;
  createMessage: () => EffectPlayMessage | Promise<EffectPlayMessage>;
}

interface SimpleMediaQueueServiceOptions {
  broadcast: (overlayId: OverlayId, message: EffectPlayMessage) => void;
  canDispatch?: (overlayId: OverlayId) => boolean;
  onError?: (error: unknown, instanceId: string) => void;
  fallbackTimeoutMs?: number;
}

export class SimpleMediaQueueService {
  private readonly pending: SimpleMediaQueueJob[] = [];
  private activeInstanceId: string | null = null;
  private pumping = false;
  private fallbackTimer: NodeJS.Timeout | null = null;
  private activeDispatchedAt = 0;
  private activePlaybackRate = 1;
  private activeTargetOverlayId: OverlayId | null = null;
  private activeDeadlineAt: number | null = null;

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
    this.resetActive();
    void this.pump();
    return true;
  }

  reportVideoDuration(instanceId: string, durationMs: number): boolean {
    if (instanceId !== this.activeInstanceId || !Number.isFinite(durationMs) || durationMs <= 0) return false;
    const expectedEndAt = this.activeDispatchedAt + durationMs / this.activePlaybackRate + 500;
    this.scheduleFallback(instanceId, Math.max(0, expectedEndAt - Date.now()));
    return true;
  }

  status(): {
    activeInstanceId: string | null;
    activeTargetOverlayId: OverlayId | null;
    activeDispatchedAt: number | null;
    activeDeadlineAt: number | null;
    waitingCount: number;
    waiting: Array<{ instanceId: string; targetOverlayId: OverlayId }>;
  } {
    return {
      activeInstanceId: this.activeInstanceId,
      activeTargetOverlayId: this.activeTargetOverlayId,
      activeDispatchedAt: this.activeDispatchedAt || null,
      activeDeadlineAt: this.activeDeadlineAt,
      waitingCount: this.pending.length,
      waiting: this.pending.map((job) => ({ instanceId: job.instanceId, targetOverlayId: job.targetOverlayId }))
    };
  }

  notifyAvailabilityChanged(): void {
    void this.pump();
  }

  clear(): { activeCleared: boolean; waitingCleared: number } {
    const result = { activeCleared: Boolean(this.activeInstanceId), waitingCleared: this.pending.length };
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = null;
    this.pending.length = 0;
    this.resetActive();
    return result;
  }

  dispose(): void {
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = null;
    this.pending.length = 0;
    this.resetActive();
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.activeInstanceId || this.pending.length === 0) return;
    if (this.options.canDispatch && !this.options.canDispatch(this.pending[0]!.targetOverlayId)) return;
    this.pumping = true;
    const job = this.pending.shift()!;
    this.activeInstanceId = job.instanceId;
    this.activeTargetOverlayId = job.targetOverlayId;
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
      const serverDurationMs = message.media?.videoDurationMs;
      const fallbackTimeoutMs = typeof serverDurationMs === "number" && Number.isFinite(serverDurationMs) && serverDurationMs > 0
        ? serverDurationMs / playbackRate + 500
        : this.options.fallbackTimeoutMs ?? 30 * 60 * 1000;
      this.scheduleFallback(job.instanceId, fallbackTimeoutMs);
    } catch (error) {
      this.options.onError?.(error, job.instanceId);
      if (this.activeInstanceId === job.instanceId) this.resetActive();
    } finally {
      this.pumping = false;
      if (!this.activeInstanceId) void this.pump();
    }
  }

  private scheduleFallback(instanceId: string, delayMs: number): void {
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.activeDeadlineAt = Date.now() + delayMs;
    this.fallbackTimer = setTimeout(() => this.complete(instanceId), delayMs);
    this.fallbackTimer.unref?.();
  }

  private resetActive(): void {
    this.activeInstanceId = null;
    this.activeTargetOverlayId = null;
    this.activeDispatchedAt = 0;
    this.activeDeadlineAt = null;
    this.activePlaybackRate = 1;
  }
}

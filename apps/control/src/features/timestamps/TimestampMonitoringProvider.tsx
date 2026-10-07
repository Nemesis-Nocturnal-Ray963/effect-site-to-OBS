import React from "react";
import { subscribeToReceivedEvents } from "../../stores/connectionStore";

const microphoneStorageKey = "obs-effect.timestamps.microphone-device-id";
const volumeThresholdStorageKey = "obs-effect.timestamps.volume-threshold";
const timestampHistoryStorageKey = "obs-effect.timestamps.history";

export interface TimestampRecord {
  id: string;
  sessionId: string;
  recordedAt: string;
  kind: "volume" | "stream-start" | "stream-end";
}

interface TimestampMonitoringValue {
  microphones: MediaDeviceInfo[];
  microphoneId: string;
  microphoneMessage: string;
  isDetecting: boolean;
  isMonitoring: boolean;
  volumeLevel: number;
  volumeThreshold: number;
  timestamps: TimestampRecord[];
  timestampHistory: TimestampRecord[];
  detectMicrophones: () => Promise<void>;
  setMicrophone: (deviceId: string) => void;
  setVolumeThreshold: (value: number) => void;
  startMonitoring: () => Promise<void>;
  stopMonitoring: () => void;
}

const TimestampMonitoringContext = React.createContext<TimestampMonitoringValue | null>(null);

function readVolumeThreshold(): number {
  const storedValue = Number(window.localStorage.getItem(volumeThresholdStorageKey));
  return Number.isFinite(storedValue) ? Math.min(100, Math.max(0, storedValue)) : 70;
}

function createSessionId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function readTimestampHistory(): TimestampRecord[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(timestampHistoryStorageKey) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is Omit<TimestampRecord, "kind"> & { kind?: TimestampRecord["kind"] } =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as TimestampRecord).id === "string" &&
        typeof (item as TimestampRecord).sessionId === "string" &&
        typeof (item as TimestampRecord).recordedAt === "string"
      )
      .map((item) => ({ ...item, kind: item.kind ?? "volume" }));
  } catch {
    return [];
  }
}

export function TimestampMonitoringProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [microphones, setMicrophones] = React.useState<MediaDeviceInfo[]>([]);
  const [microphoneId, setMicrophoneId] = React.useState(() => window.localStorage.getItem(microphoneStorageKey) ?? "");
  const [microphoneMessage, setMicrophoneMessage] = React.useState("");
  const [isDetecting, setIsDetecting] = React.useState(false);
  const [isMonitoring, setIsMonitoring] = React.useState(false);
  const [volumeLevel, setVolumeLevel] = React.useState(0);
  const [volumeThreshold, setVolumeThresholdState] = React.useState(readVolumeThreshold);
  const [timestamps, setTimestamps] = React.useState<TimestampRecord[]>([]);
  const [timestampHistory, setTimestampHistory] = React.useState(readTimestampHistory);
  const microphoneIdRef = React.useRef(microphoneId);
  const volumeThresholdRef = React.useRef(volumeThreshold);
  const sessionIdRef = React.useRef(createSessionId());
  const wasOverThresholdRef = React.useRef(false);
  const streamRef = React.useRef<MediaStream | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const animationFrameRef = React.useRef<number | null>(null);
  const isMonitoringRef = React.useRef(false);
  const processedEventIdsRef = React.useRef(new Set<string>());

  const recordTimestamp = React.useCallback((kind: TimestampRecord["kind"], recordedAt = new Date().toISOString()): void => {
    if (kind === "stream-start") {
      sessionIdRef.current = createSessionId();
    }
    const timestamp: TimestampRecord = {
      id: `${recordedAt}-${crypto.randomUUID?.() ?? Math.random()}`,
      sessionId: sessionIdRef.current,
      recordedAt,
      kind
    };
    setTimestamps((current) => (kind === "stream-start" ? [timestamp] : [...current, timestamp]));
    setTimestampHistory((current) => {
      const nextHistory = [...current, timestamp];
      window.localStorage.setItem(timestampHistoryStorageKey, JSON.stringify(nextHistory));
      return nextHistory;
    });
  }, []);

  const loadMicrophones = React.useCallback(async (): Promise<void> => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setMicrophoneMessage("Microphone selection is not supported by this browser.");
      return;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    setMicrophones(devices.filter((device) => device.kind === "audioinput"));
  }, []);

  const stopMonitoring = React.useCallback((): void => {
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioContextRef.current) void audioContextRef.current.close();
    audioContextRef.current = null;
    wasOverThresholdRef.current = false;
    isMonitoringRef.current = false;
    setIsMonitoring(false);
    setVolumeLevel(0);
  }, []);

  const startMonitoringInternal = React.useCallback(
    async (deviceId: string, resetSession: boolean): Promise<void> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMicrophoneMessage("Microphone selection is not supported by this browser.");
        return;
      }

      stopMonitoring();
      setMicrophoneMessage("");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true
        });
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.75;
        audioContext.createMediaStreamSource(stream).connect(analyser);

        streamRef.current = stream;
        audioContextRef.current = audioContext;
        if (resetSession) {
          sessionIdRef.current = createSessionId();
          setTimestamps([]);
        }
        isMonitoringRef.current = true;
        setIsMonitoring(true);
        await loadMicrophones();

        const samples = new Float32Array(analyser.fftSize);
        const updateMeter = (): void => {
          analyser.getFloatTimeDomainData(samples);
          let sumOfSquares = 0;
          for (const sample of samples) sumOfSquares += sample * sample;
          const rms = Math.sqrt(sumOfSquares / samples.length);
          const decibels = 20 * Math.log10(Math.max(rms, 0.001));
          const roundedLevel = Math.round(Math.min(100, Math.max(0, ((decibels + 60) / 60) * 100)));
          setVolumeLevel(roundedLevel);

          if (roundedLevel >= volumeThresholdRef.current && !wasOverThresholdRef.current) {
            wasOverThresholdRef.current = true;
            recordTimestamp("volume");
          } else if (roundedLevel < Math.max(0, volumeThresholdRef.current - 3)) {
            wasOverThresholdRef.current = false;
          }
          animationFrameRef.current = window.requestAnimationFrame(updateMeter);
        };
        updateMeter();
      } catch {
        stopMonitoring();
        setMicrophoneMessage("Could not start microphone monitoring.");
      }
    },
    [loadMicrophones, recordTimestamp, stopMonitoring]
  );

  const startMonitoring = React.useCallback(
    () => startMonitoringInternal(microphoneIdRef.current, true),
    [startMonitoringInternal]
  );

  const detectMicrophones = React.useCallback(async (): Promise<void> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicrophoneMessage("Microphone selection is not supported by this browser.");
      return;
    }
    setIsDetecting(true);
    setMicrophoneMessage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      await loadMicrophones();
      setMicrophoneMessage("Microphones detected. Choose the microphone to use.");
      if (!isMonitoringRef.current) await startMonitoringInternal(microphoneIdRef.current, true);
    } catch {
      setMicrophoneMessage("Microphone access was not granted.");
    } finally {
      setIsDetecting(false);
    }
  }, [loadMicrophones, startMonitoringInternal]);

  const setMicrophone = React.useCallback(
    (deviceId: string): void => {
      microphoneIdRef.current = deviceId;
      setMicrophoneId(deviceId);
      window.localStorage.setItem(microphoneStorageKey, deviceId);
      if (isMonitoringRef.current) void startMonitoringInternal(deviceId, false);
      else setMicrophoneMessage("Microphone selection saved.");
    },
    [startMonitoringInternal]
  );

  const setVolumeThreshold = React.useCallback((value: number): void => {
    const nextThreshold = Math.min(100, Math.max(0, value || 0));
    volumeThresholdRef.current = nextThreshold;
    wasOverThresholdRef.current = false;
    setVolumeThresholdState(nextThreshold);
    window.localStorage.setItem(volumeThresholdStorageKey, String(nextThreshold));
  }, []);

  React.useEffect(() => {
    void loadMicrophones().catch(() => setMicrophoneMessage("Could not load microphones."));
    const handleDeviceChange = (): void => {
      void loadMicrophones().catch(() => setMicrophoneMessage("Could not load microphones."));
    };
    navigator.mediaDevices?.addEventListener("devicechange", handleDeviceChange);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", handleDeviceChange);
  }, [loadMicrophones]);

  React.useEffect(
    () =>
      subscribeToReceivedEvents((entry) => {
        if (entry.event.type !== "stream-start" && entry.event.type !== "stream-end") return;
        if (processedEventIdsRef.current.has(entry.event.eventId)) return;
        processedEventIdsRef.current.add(entry.event.eventId);
        recordTimestamp(entry.event.type, entry.event.timestamp);
      }),
    [recordTimestamp]
  );

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => void startMonitoring(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [startMonitoring]);

  React.useEffect(() => stopMonitoring, [stopMonitoring]);

  const value = React.useMemo<TimestampMonitoringValue>(
    () => ({
      microphones,
      microphoneId,
      microphoneMessage,
      isDetecting,
      isMonitoring,
      volumeLevel,
      volumeThreshold,
      timestamps,
      timestampHistory,
      detectMicrophones,
      setMicrophone,
      setVolumeThreshold,
      startMonitoring,
      stopMonitoring
    }),
    [
      microphones,
      microphoneId,
      microphoneMessage,
      isDetecting,
      isMonitoring,
      volumeLevel,
      volumeThreshold,
      timestamps,
      timestampHistory,
      detectMicrophones,
      setMicrophone,
      setVolumeThreshold,
      startMonitoring,
      stopMonitoring
    ]
  );

  return <TimestampMonitoringContext.Provider value={value}>{children}</TimestampMonitoringContext.Provider>;
}

export function useTimestampMonitoring(): TimestampMonitoringValue {
  const value = React.useContext(TimestampMonitoringContext);
  if (!value) throw new Error("useTimestampMonitoring must be used inside TimestampMonitoringProvider");
  return value;
}

declare module "tiktok-live-connector" {
  export interface DecodedData {
    type?: string;
    data?: unknown;
  }

  export interface BaseProtoMessage {
    method?: string;
    payload?: Uint8Array;
    msgId?: string;
    isHistory?: boolean;
    decodedData?: DecodedData;
  }

  export const BaseProtoMessage: {
    decode(input: Uint8Array): Record<string, unknown>;
  };

  export interface ProtoMessageFetchResult {
    messages?: BaseProtoMessage[];
  }

  export interface DecodedWebcastPushFrame {
    payloadEncoding?: string;
    payloadType?: string;
    protoMessageFetchResult?: ProtoMessageFetchResult;
  }

  export const WebcastDeserializeConfig: {
    skipMessageTypes: string[];
    includeMessageTypes: string[];
    showBase64OnDecodeError: boolean;
  };

  export function deserializeWebSocketMessage(binaryMessage: Uint8Array): Promise<DecodedWebcastPushFrame>;

  export function createBaseWebcastPushFrame(options: { payload: Uint8Array; payloadEncoding?: string }): { finish(): Uint8Array };

  export const ProtoMessageFetchResult: {
    encode(message: unknown): { finish(): Uint8Array };
    decode(input: Uint8Array): Record<string, unknown>;
  };

  export const WebcastChatMessage: {
    encode(message: unknown): { finish(): Uint8Array };
    decode(input: Uint8Array): Record<string, unknown>;
  };

  export const WebcastGiftMessage: {
    encode(message: unknown): { finish(): Uint8Array };
    decode(input: Uint8Array): Record<string, unknown>;
  };

  export const CommonMessageData: {
    decode(input: Uint8Array): Record<string, unknown>;
  };

  export const User: {
    decode(input: Uint8Array): Record<string, unknown>;
  };

  export const Gift: {
    decode(input: Uint8Array): Record<string, unknown>;
  };

  export class TikTokLiveConnection {
    constructor(uniqueId: string, options?: Record<string, unknown>);
    connect(): Promise<{ roomId?: string }>;
    disconnect(): Promise<void>;
    on(event: string, handler: (payload: unknown) => void): void;
  }

  export const WebcastEvent: Record<string, string>;
}

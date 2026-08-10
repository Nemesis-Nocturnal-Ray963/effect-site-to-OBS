import { randomUUID } from "node:crypto";

export const appVersion = "0.1.0";
export const buildVersion = process.env.BUILD_VERSION ?? process.env.VITE_BUILD_VERSION ?? "dev";
export const overlayBundleVersion = process.env.OVERLAY_BUILD_VERSION ?? buildVersion;
export const serverInstanceId = randomUUID();

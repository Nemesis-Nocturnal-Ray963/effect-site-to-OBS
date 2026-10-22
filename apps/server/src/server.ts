import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { createSoundboardRemoteApp } from "./soundboard/createSoundboardRemoteApp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../..");
const port = Number(process.env.PORT ?? 3190);
const bindAddress = process.env.BIND_ADDRESS ?? "127.0.0.1";
const soundboardRemotePort = Number(process.env.SOUNDBOARD_REMOTE_PORT ?? port + 1);

const app = await createApp({ rootDir, bindAddress, port, soundboardRemotePort });

await app.listen({ host: bindAddress, port });

const soundboardRemoteApp = await createSoundboardRemoteApp({
  rootDir,
  targetBaseUrl: `http://127.0.0.1:${port}`
});
await soundboardRemoteApp.listen({ host: "0.0.0.0", port: soundboardRemotePort });

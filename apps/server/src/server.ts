import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../..");
const port = Number(process.env.PORT ?? 3190);
const bindAddress = process.env.BIND_ADDRESS ?? "127.0.0.1";

const app = await createApp({ rootDir, bindAddress, port });

await app.listen({ host: bindAddress, port });

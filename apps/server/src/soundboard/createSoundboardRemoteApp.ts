import path from "node:path";
import { createReadStream } from "node:fs";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";

interface SoundboardRemoteAppOptions {
  rootDir: string;
  targetBaseUrl: string;
}

export async function createSoundboardRemoteApp(options: SoundboardRemoteAppOptions) {
  const app = Fastify({ logger: true, bodyLimit: 16 * 1024 });

  app.get("/health", async () => ({ status: "ok", service: "soundboard-remote" }));

  app.get("/api/v1/soundboard/remote", async (request, reply) =>
    forward(request, reply, options.targetBaseUrl, "/api/v1/soundboard/remote")
  );
  app.post("/api/v1/soundboard/pads/:padId/play", async (request, reply) => {
    const padId = encodeURIComponent((request.params as { padId: string }).padId);
    return forward(request, reply, options.targetBaseUrl, `/api/v1/soundboard/pads/${padId}/play`);
  });
  app.post("/api/v1/soundboard/stop-all", async (request, reply) =>
    forward(request, reply, options.targetBaseUrl, "/api/v1/soundboard/stop-all")
  );

  await app.register(fastifyStatic, {
    root: path.join(options.rootDir, "apps/control/dist/assets"),
    prefix: "/control/assets/",
    decorateReply: false,
    setHeaders: (response) => {
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      response.setHeader("X-Content-Type-Options", "nosniff");
    }
  });

  app.get("/control/soundboard/remote", async (_request, reply) =>
    reply
      .header("Cache-Control", "no-cache, no-store, must-revalidate")
      .type("text/html")
      .send(createReadStream(path.join(options.rootDir, "apps/control/dist/index.html")))
  );

  return app;
}

async function forward(request: FastifyRequest, reply: FastifyReply, targetBaseUrl: string, pathname: string) {
  const token = request.headers["x-soundboard-token"];
  const response = await fetch(`${targetBaseUrl}${pathname}`, {
    method: request.method,
    headers: {
      ...(typeof token === "string" ? { "X-Soundboard-Token": token } : {}),
      ...(request.method === "POST" ? { "Content-Type": "application/json" } : {})
    },
    body: request.method === "POST" ? "{}" : undefined
  });
  const contentType = response.headers.get("content-type");
  if (contentType) reply.type(contentType);
  return reply.code(response.status).send(await response.text());
}

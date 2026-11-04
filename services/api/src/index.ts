import { loadDotEnv } from "@zeno/config";
loadDotEnv();

const { buildServer } = await import("./server.js");

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 4000);
const app = buildServer();

app.listen({ port, host: process.env.HOST ?? "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});

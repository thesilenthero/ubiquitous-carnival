import express from "express";
import compression from "compression";
import cors from "cors";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initSchema } from "./db.js";
import { applicationsRouter } from "./routes/applications.js";
import { contactsRouter } from "./routes/contacts.js";
import { suggestionsRouter } from "./routes/suggestions.js";
import { dataRouter } from "./routes/data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

initSchema();

const app = express();
app.use(compression());
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/applications", applicationsRouter);
app.use("/api/contacts", contactsRouter);
app.use("/api/suggestions", suggestionsRouter);
app.use("/api", dataRouter);

// In production, serve the built SPA and fall back to index.html for client
// routing. In dev the Vite server handles the frontend and proxies /api here.
const distDir = resolve(__dirname, "../../web/dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(resolve(distDir, "index.html"));
  });
}

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => {
  console.log(`Job tracker API listening on http://localhost:${PORT}`);
});

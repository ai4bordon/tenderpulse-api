#!/usr/bin/env node
// ТендерПульс — HTTP-адаптер: превращает запросы в вызовы ядра (src/app.js).
// Зависимостей нет: только стандартная библиотека Node.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, createStore, demoData } from "./src/app.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.join(ROOT, "data", "store.json");
const PORT = Number(process.env.PORT || 3000);

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
  } catch {
    const data = demoData();
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2));
    return data;
  }
}

const store = createStore(loadStore(), { file: STORE_FILE, fs });
const app = createApp({ store });

/** Лимит тела запроса (AUD-02): без него один большой POST кладёт процесс —
    чанки копятся в памяти без границ. 1 МБ с запасом покрывает честные тела
    этого API (заказы, клиенты, комментарии). */
const MAX_BODY = 1_000_000;

const readBody = async (req) => {
  let raw = "";
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) return "TOO_LARGE";
    raw += chunk;
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const server = http.createServer(async (req, res) => {
  const send = (status, payload) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-Token",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    });
    res.end(JSON.stringify(payload));
  };

  if (req.method === "OPTIONS") return send(204, {});

  const pathname = req.url || "/";
  const token = req.headers["x-token"] || null;

  // Корень отдаёт карту API — удобно для проверки и для портфолио.
  if (pathname === "/") {
    return send(200, {
      service: "ТендерПульс API — трекер этапов выполнения заказов",
      version: "1.0.0",
      docs: "README.md",
      requirements:
        "ТЗ_для_дизайнера.md — user flow и функциональные требования",
      stages: [
        "new",
        "in_progress",
        "on_review",
        "done",
        "closed",
        "cancelled",
      ],
      demoAccounts: [
        { email: "anna@tenderpulse.ru", role: "admin" },
        { email: "maxim@tenderpulse.ru", role: "manager" },
        { email: "ilya@tenderpulse.ru", role: "executor" },
      ],
      password: "tenderpulse",
      authHeader: "X-Token: <token из POST /api/login>",
      endpoints: [
        "POST /api/login",
        "POST /api/logout",
        "GET /api/me",
        "GET /api/dashboard",
        "GET /api/search?q=",
        "GET /api/users",
        "POST /api/users",
        "PATCH /api/users/:id",
        "DELETE /api/users/:id",
        "GET /api/clients",
        "POST /api/clients",
        "GET /api/clients/:id",
        "PATCH /api/clients/:id",
        "DELETE /api/clients/:id",
        "GET /api/orders?stage=&executorId=&clientId=&overdue=1&soon=1&due=week&scope=mine&q=&sort=",
        "POST /api/orders",
        "GET /api/orders/:id",
        "PATCH /api/orders/:id",
        "DELETE /api/orders/:id",
        "POST /api/orders/:id/assignee",
        "POST /api/orders/:id/stage",
        "POST /api/orders/:id/comments",
        "PATCH /api/comments/:id",
        "DELETE /api/comments/:id",
        "POST /api/orders/:id/attachments",
        "DELETE /api/orders/:id/attachments/:attachmentId",
        "GET /api/notifications",
        "POST /api/notifications/:id/read",
        "POST /api/notifications/read-all",
        "GET /api/reports/funnel",
        "GET /api/reports/stage-time",
        "GET /api/reports/workload",
        "GET /api/reports/overdue",
        "GET /api/reports/summary",
      ],
    });
  }

  if (!pathname.startsWith("/api/"))
    return send(404, { error: "Неизвестный адрес" });

  const body =
    req.method === "GET" || req.method === "DELETE" ? {} : await readBody(req);
  if (body === null)
    return send(400, { error: "Некорректный JSON в теле запроса" });
  if (body === "TOO_LARGE")
    return send(413, { error: "Тело запроса слишком большое (лимит 1 МБ)" });

  const result = app.dispatch(req.method, pathname, { body, token });
  return send(result.status, result.body);
});

server.listen(PORT, () => {
  console.log(`ТендерПульс API: http://localhost:${PORT}`);
  console.log("Демо-вход: anna@tenderpulse.ru / tenderpulse (администратор)");
});

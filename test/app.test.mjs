// Проверка требований ТЗ клиента: этапы заказов, сроки, информирование и права ролей.
// Тесты ходят в ядро напрямую — порт не поднимается, данные не пишутся на диск.
import test from "node:test";
import assert from "node:assert/strict";
import { createApp, createStore, demoData, STAGES } from "../src/app.js";

const TODAY = new Date("2026-03-10T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const shift = (days) => new Date(TODAY.getTime() + days * DAY).toISOString();

function setup() {
  const store = createStore(demoData(TODAY));
  const app = createApp({ store, today: () => TODAY });
  const login = (email) =>
    app.dispatch("POST", "/api/login", {
      body: { email, password: "tenderpulse" },
    }).body.token;
  return { app, store, login };
}

const ADMIN = "anna@tenderpulse.ru";
const MANAGER = "maxim@tenderpulse.ru";
const EXECUTOR = "ilya@tenderpulse.ru";
const OTHER_EXECUTOR = "viktor@tenderpulse.ru";

test("1. Вход, выход и сохранение сессии в хранилище", () => {
  const { app, store, login } = setup();
  assert.equal(
    app.dispatch("POST", "/api/login", {
      body: { email: ADMIN, password: "неверный" },
    }).status,
    401,
  );
  assert.equal(
    app.dispatch("GET", "/api/me").status,
    401,
    "без токена доступа нет",
  );

  const token = login(ADMIN);
  assert.ok(token);
  assert.equal(
    app.dispatch("GET", "/api/me", { token }).body.user.role,
    "admin",
  );
  assert.equal(
    store.state.sessions[token],
    "u1",
    "сессия записана в хранилище",
  );

  // Новый экземпляр ядра на том же хранилище — как перезапуск сервера.
  const restarted = createApp({ store, today: () => TODAY });
  assert.equal(
    restarted.dispatch("GET", "/api/me", { token }).status,
    200,
    "вход переживает перезапуск",
  );

  assert.equal(app.dispatch("POST", "/api/logout", { token }).status, 200);
  assert.equal(
    app.dispatch("GET", "/api/me", { token }).status,
    401,
    "после выхода токен не работает",
  );
});

test("2. Сотрудников создаёт администратор, роли разграничены", () => {
  const { app, login } = setup();
  const admin = login(ADMIN);
  const manager = login(MANAGER);
  const executor = login(EXECUTOR);

  assert.equal(
    app.dispatch("POST", "/api/users", {
      token: manager,
      body: { name: "Свой", email: "x@t.ru" },
    }).status,
    403,
  );
  assert.equal(
    app.dispatch("POST", "/api/users", {
      token: executor,
      body: { name: "Свой", email: "y@t.ru" },
    }).status,
    403,
  );
  assert.equal(
    app.dispatch("POST", "/api/users", {
      token: admin,
      body: { name: "Без почты" },
    }).status,
    400,
  );

  const created = app.dispatch("POST", "/api/users", {
    token: admin,
    body: {
      name: "Пётр Нов",
      email: "petr@tenderpulse.ru",
      role: "executor",
      position: "Юрист по закупкам",
      password: "secret12",
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.role, "executor");
  assert.equal(
    created.body.user.password,
    undefined,
    "пароль наружу не отдаём",
  );
  assert.equal(
    app.dispatch("POST", "/api/users", {
      token: admin,
      body: { name: "Дубль", email: ADMIN },
    }).status,
    409,
  );

  assert.equal(
    app.dispatch("GET", "/api/users", { token: executor }).status,
    403,
    "исполнитель не видит список сотрудников",
  );
  assert.equal(
    app.dispatch("GET", "/api/users", { token: manager }).body.users.length,
    6,
  );
  const patched = app.dispatch("PATCH", `/api/users/${created.body.user.id}`, {
    token: admin,
    body: { role: "manager" },
  });
  assert.equal(patched.body.user.role, "manager");
  assert.equal(
    app.dispatch("PATCH", "/api/users/u1", {
      token: manager,
      body: { name: "Взлом" },
    }).status,
    403,
  );
});

test("3. Клиенты: список, создание, карточка, правка, удаление", () => {
  const { app, login } = setup();
  const admin = login(ADMIN);
  const manager = login(MANAGER);
  const executor = login(EXECUTOR);

  assert.equal(
    app.dispatch("GET", "/api/clients", { token: executor }).status,
    403,
    "исполнителю список клиентов не нужен",
  );
  assert.equal(
    app.dispatch("GET", "/api/clients", { token: manager }).body.clients.length,
    6,
  );

  const created = app.dispatch("POST", "/api/clients", {
    token: manager,
    body: {
      name: "ООО «Новый клиент»",
      contactName: "Иван Петров",
      email: "i@p.ru",
    },
  });
  assert.equal(created.status, 201);
  const clientId = created.body.client.id;
  assert.equal(
    app.dispatch("POST", "/api/clients", {
      token: manager,
      body: { name: "   " },
    }).status,
    400,
  );

  const card = app.dispatch("GET", `/api/clients/${clientId}`, {
    token: manager,
  });
  assert.equal(card.status, 200);
  assert.deepEqual(card.body.orders, [], "у нового клиента ещё нет заказов");

  const patched = app.dispatch("PATCH", `/api/clients/${clientId}`, {
    token: manager,
    body: { status: "archived", phone: "+7 900 000-00-00" },
  });
  assert.equal(patched.body.client.status, "archived");
  assert.equal(
    app
      .dispatch("GET", "/api/clients?status=archived", { token: manager })
      .body.clients.some((c) => c.id === clientId),
    true,
  );
  assert.equal(
    app.dispatch("GET", "/api/clients/c99", { token: manager }).status,
    404,
  );

  assert.equal(
    app.dispatch("DELETE", "/api/clients/c1", { token: admin }).status,
    409,
    "клиента с заказами не удаляем",
  );
  assert.equal(
    app.dispatch("DELETE", `/api/clients/${clientId}`, { token: admin }).status,
    200,
  );
  assert.equal(
    app.dispatch("GET", `/api/clients/${clientId}`, { token: manager }).status,
    404,
  );
});

test("4. Заказы: создание, карточка, правка полей, удаление", () => {
  const { app, login } = setup();
  const admin = login(ADMIN);
  const manager = login(MANAGER);
  const executor = login(EXECUTOR);

  assert.equal(
    app.dispatch("GET", "/api/orders", { token: manager }).body.total,
    24,
    "в демо-данных 24 заказа",
  );
  assert.equal(
    app.dispatch("POST", "/api/orders", {
      token: executor,
      body: { title: "Самозахват", clientId: "c1" },
    }).status,
    403,
  );

  assert.equal(
    app.dispatch("POST", "/api/orders", {
      token: manager,
      body: { clientId: "c1", stageDueDate: shift(7) },
    }).status,
    400,
    "нужно название",
  );
  assert.equal(
    app.dispatch("POST", "/api/orders", {
      token: manager,
      body: { title: "Заказ", clientId: "c99", stageDueDate: shift(7) },
    }).status,
    404,
    "клиента нет",
  );
  assert.equal(
    app.dispatch("POST", "/api/orders", {
      token: manager,
      body: { title: "Заказ", clientId: "c1" },
    }).status,
    400,
    "нужен срок этапа",
  );

  const created = app.dispatch("POST", "/api/orders", {
    token: manager,
    body: {
      title: "Закупка мебели для склада",
      clientId: "c1",
      executorId: "u4",
      amount: 500000,
      stageDueDate: shift(5),
    },
  });
  assert.equal(created.status, 201);
  const order = created.body.order;
  assert.match(order.number, /^ЗК-10\d\d$/);
  assert.equal(order.stage, "new");
  assert.equal(order.stageTitle, "Новый");
  assert.equal(order.executor.id, "u4");

  const card = app.dispatch("GET", `/api/orders/${order.id}`, {
    token: manager,
  });
  assert.equal(card.body.history.length, 1);
  assert.equal(card.body.history[0].field, "created");
  assert.deepEqual(
    card.body.nextStages.map((s) => s.stage),
    ["in_progress", "cancelled"],
    "из «Нового» только в работу или в отмену",
  );
  assert.equal(card.body.canEdit, true);

  const patched = app.dispatch("PATCH", `/api/orders/${order.id}`, {
    token: manager,
    body: { title: "Закупка мебели для склада (уточнено)", amount: 550000 },
  });
  assert.equal(patched.body.order.amount, 550000);
  assert.equal(
    app.dispatch("PATCH", `/api/orders/${order.id}`, {
      token: executor,
      body: { title: "нет прав" },
    }).status,
    403,
  );

  assert.equal(
    app.dispatch("DELETE", `/api/orders/${order.id}`, { token: manager })
      .status,
    403,
    "удаляет только администратор",
  );
  assert.equal(
    app.dispatch("DELETE", `/api/orders/${order.id}`, { token: admin }).status,
    200,
  );
  assert.equal(
    app.dispatch("GET", `/api/orders/${order.id}`, { token: manager }).status,
    404,
  );
});

test("5. Смена этапа пишет историю и уведомляет заинтересованных", () => {
  const { app, login } = setup();
  const manager = login(MANAGER);
  const executor = login(EXECUTOR);

  const moved = app.dispatch("POST", "/api/orders/o3/stage", {
    token: manager,
    body: { stage: "in_progress" },
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.previousStage, "new");
  assert.equal(moved.body.order.stage, "in_progress");
  assert.equal(
    moved.body.order.daysLeft,
    5,
    "новый этап без явного срока получает дедлайн через 5 дней",
  );

  const card = app.dispatch("GET", "/api/orders/o3", { token: manager });
  const stageEvents = card.body.history.filter((h) => h.field === "stage");
  assert.equal(stageEvents.length, 1);
  assert.equal(stageEvents[0].from, "new");
  assert.equal(stageEvents[0].to, "in_progress");
  assert.equal(stageEvents[0].toTitle, "В работе");
  assert.equal(stageEvents[0].user, "Максим Орлов");

  const executorNotifications = app.dispatch("GET", "/api/notifications", {
    token: executor,
  }).body.notifications;
  assert.ok(
    executorNotifications.some((n) => n.type === "stage" && n.orderId === "o3"),
    "исполнитель узнал о смене этапа",
  );

  // Полный путь до закрытия: новый → в работе → на проверке → выполнен → закрыт.
  assert.equal(
    app.dispatch("POST", "/api/orders/o3/stage", {
      token: manager,
      body: { stage: "on_review" },
    }).status,
    200,
  );
  assert.equal(
    app.dispatch("POST", "/api/orders/o3/stage", {
      token: manager,
      body: { stage: "done" },
    }).status,
    200,
  );
  const closed = app.dispatch("POST", "/api/orders/o3/stage", {
    token: manager,
    body: { stage: "closed" },
  });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.order.stage, "closed");
  assert.ok(closed.body.order.closedAt, "дата закрытия заполнена");
  assert.deepEqual(
    app.dispatch("GET", "/api/orders/o3", { token: manager }).body.nextStages,
    [],
    "из закрытого этапа выхода нет",
  );
});

test("6. Краевые случаи смены этапа: тот же этап, прыжок, закрытый заказ, отмена и возврат", () => {
  const { app, login } = setup();
  const manager = login(MANAGER);

  const same = app.dispatch("POST", "/api/orders/o1/stage", {
    token: manager,
    body: { stage: "in_progress" },
  });
  assert.equal(same.status, 400);
  assert.match(same.body.error, /уже на этапе/);

  assert.equal(
    app.dispatch("POST", "/api/orders/o3/stage", {
      token: manager,
      body: { stage: "on_review" },
    }).status,
    422,
    "через этап не перепрыгиваем",
  );
  assert.equal(
    app.dispatch("POST", "/api/orders/o3/stage", {
      token: manager,
      body: { stage: "нет такого" },
    }).status,
    400,
  );
  assert.equal(
    app.dispatch("POST", "/api/orders/o6/stage", {
      token: manager,
      body: { stage: "cancelled", reason: "поздно" },
    }).status,
    409,
    "закрытый заказ не меняем",
  );

  const backward = app.dispatch("POST", "/api/orders/o1/stage", {
    token: manager,
    body: { stage: "new" },
  });
  assert.equal(backward.status, 400, "возврат назад без причины запрещён");
  assert.equal(
    app.dispatch("POST", "/api/orders/o1/stage", {
      token: manager,
      body: { stage: "new", reason: "клиент поменял требования" },
    }).status,
    200,
  );

  const cancelled = app.dispatch("POST", "/api/orders/o1/stage", {
    token: manager,
    body: { stage: "cancelled" },
  });
  assert.equal(cancelled.status, 400, "отмена без причины запрещена");
  const withReason = app.dispatch("POST", "/api/orders/o1/stage", {
    token: manager,
    body: { stage: "cancelled", reason: "клиент ушёл к конкуренту" },
  });
  assert.equal(withReason.status, 200);
  assert.equal(withReason.body.order.cancelReason, "клиент ушёл к конкуренту");

  assert.equal(
    app.dispatch("POST", "/api/orders/o1/stage", {
      token: manager,
      body: { stage: "in_progress", reason: "вернули" },
    }).status,
    422,
    "из отмены только в «Новый»",
  );
  const restored = app.dispatch("POST", "/api/orders/o1/stage", {
    token: manager,
    body: { stage: "new", reason: "клиент вернулся" },
  });
  assert.equal(restored.status, 200);
  assert.equal(
    restored.body.order.cancelReason,
    null,
    "причина отмены сброшена",
  );
});

test("7. Исполнитель ведёт только свои заказы и только в пределах работы", () => {
  const { app, login } = setup();
  const executor = login(EXECUTOR);

  assert.equal(
    app.dispatch("POST", "/api/orders/o2/stage", {
      token: executor,
      body: { stage: "in_progress" },
    }).status,
    403,
    "чужой заказ",
  );
  assert.equal(
    app.dispatch("GET", "/api/orders/o2", { token: executor }).status,
    403,
  );
  assert.equal(
    app.dispatch("POST", "/api/orders/o1/comments", {
      token: executor,
      body: { text: "привет" },
    }).status,
    201,
    "свой заказ — можно",
  );

  assert.equal(
    app.dispatch("POST", "/api/orders/o1/stage", {
      token: executor,
      body: { stage: "on_review" },
    }).status,
    200,
  );
  assert.equal(
    app.dispatch("POST", "/api/orders/o1/stage", {
      token: executor,
      body: { stage: "done" },
    }).status,
    403,
    "приёмку делает менеджер",
  );
  assert.equal(
    app.dispatch("POST", "/api/orders/o1/stage", {
      token: executor,
      body: { stage: "cancelled", reason: "не хочу" },
    }).status,
    403,
  );
  const back = app.dispatch("POST", "/api/orders/o1/stage", {
    token: executor,
    body: { stage: "in_progress", reason: "замечания клиента" },
  });
  assert.equal(
    back.status,
    200,
    "вернуть свою работу в «В работе» исполнитель может",
  );
});

test("8. Назначение исполнителя: проверки и уведомление", () => {
  const { app, login } = setup();
  const manager = login(MANAGER);
  const executor = login(EXECUTOR);
  const other = login(OTHER_EXECUTOR);

  assert.equal(
    app.dispatch("POST", "/api/orders/o3/assignee", {
      token: executor,
      body: { executorId: "u4" },
    }).status,
    403,
  );
  assert.equal(
    app.dispatch("POST", "/api/orders/o3/assignee", {
      token: manager,
      body: { executorId: "u99" },
    }).status,
    404,
    "такого сотрудника нет",
  );
  assert.equal(
    app.dispatch("POST", "/api/orders/o3/assignee", {
      token: manager,
      body: { executorId: "u2" },
    }).status,
    422,
    "менеджер не исполнитель",
  );
  assert.equal(
    app.dispatch("POST", "/api/orders/o3/assignee", {
      token: manager,
      body: { executorId: "u4" },
    }).status,
    400,
    "он уже назначен",
  );

  const assigned = app.dispatch("POST", "/api/orders/o3/assignee", {
    token: manager,
    body: { executorId: "u5" },
  });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.order.executor.id, "u5");
  assert.ok(
    app
      .dispatch("GET", "/api/notifications", { token: other })
      .body.notifications.some(
        (n) => n.type === "assigned" && n.orderId === "o3",
      ),
  );

  const card = app.dispatch("GET", "/api/orders/o3", { token: manager });
  const entry = card.body.history.find((h) => h.field === "executorId");
  assert.equal(entry.from, "Илья Морозов");
  assert.equal(entry.to, "Виктор Лебедев");

  assert.equal(
    app.dispatch("POST", "/api/orders/o3/assignee", {
      token: manager,
      body: { executorId: null },
    }).status,
    200,
    "исполнителя можно снять",
  );
  assert.equal(
    app.dispatch("GET", "/api/orders/o3", { token: manager }).body.order
      .executor,
    null,
  );
  assert.equal(
    app
      .dispatch("GET", "/api/orders", { token: other })
      .body.orders.some((o) => o.id === "o3"),
    false,
    "снятый заказ исчез из списка исполнителя",
  );
});

test("9. Срок этапа в прошлом: заказ становится просроченным", () => {
  const { app, login } = setup();
  const manager = login(MANAGER);
  const executor = login(EXECUTOR);

  const patched = app.dispatch("PATCH", "/api/orders/o3", {
    token: manager,
    body: { stageDueDate: shift(-1) },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.order.overdue, true);
  assert.ok(patched.body.order.daysLeft < 0);

  const card = app.dispatch("GET", "/api/orders/o3", { token: manager });
  assert.ok(
    card.body.history.some((h) => h.field === "stageDueDate"),
    "изменение срока попало в историю",
  );
  assert.ok(
    app
      .dispatch("GET", "/api/notifications", { token: executor })
      .body.notifications.some(
        (n) => n.type === "deadline" && n.orderId === "o3",
      ),
  );

  const withPast = app.dispatch("POST", "/api/orders/o3/stage", {
    token: manager,
    body: { stage: "in_progress", stageDueDate: shift(-3) },
  });
  assert.equal(withPast.status, 200);
  assert.equal(withPast.body.order.overdue, true);
  assert.equal(
    app
      .dispatch("GET", "/api/orders?overdue=1", { token: manager })
      .body.orders.some((o) => o.id === "o3"),
    true,
  );
  assert.ok(
    app
      .dispatch("GET", "/api/notifications", { token: executor })
      .body.notifications.some(
        (n) => n.type === "overdue" && n.orderId === "o3",
      ),
  );
});

test("10. Комментарии и вложения-ссылки", () => {
  const { app, login } = setup();
  const admin = login(ADMIN);
  const manager = login(MANAGER);
  const executor = login(EXECUTOR);
  const other = login(OTHER_EXECUTOR);

  assert.equal(
    app.dispatch("POST", "/api/orders/o1/comments", {
      token: executor,
      body: { text: "   " },
    }).status,
    400,
  );
  assert.equal(
    app.dispatch("POST", "/api/orders/o2/comments", {
      token: executor,
      body: { text: "чужой заказ" },
    }).status,
    403,
  );

  const created = app.dispatch("POST", "/api/orders/o1/comments", {
    token: executor,
    body: { text: "Документы собраны, загружаю на площадку." },
  });
  assert.equal(created.status, 201);
  const commentId = created.body.comment.id;
  assert.equal(
    app.dispatch("PATCH", `/api/comments/${commentId}`, {
      token: executor,
      body: { text: "Документы собраны и загружены." },
    }).status,
    200,
  );
  assert.equal(
    app.dispatch("PATCH", `/api/comments/${commentId}`, {
      token: other,
      body: { text: "чужое" },
    }).status,
    403,
  );
  assert.ok(
    app
      .dispatch("GET", "/api/orders/o1", { token: manager })
      .body.comments.some((c) => c.id === commentId),
  );
  assert.equal(
    app.dispatch("DELETE", `/api/comments/${commentId}`, { token: other })
      .status,
    403,
  );
  assert.equal(
    app.dispatch("DELETE", `/api/comments/${commentId}`, { token: admin })
      .status,
    200,
  );

  assert.equal(
    app.dispatch("POST", "/api/orders/o1/attachments", {
      token: executor,
      body: { title: "Смета", url: "ftp://files/1" },
    }).status,
    400,
    "принимаем только http(s)",
  );
  const attachment = app.dispatch("POST", "/api/orders/o1/attachments", {
    token: executor,
    body: {
      title: "Смета поставщика",
      url: "https://drive.tenderpulse.ru/docs/smeta.pdf",
    },
  });
  assert.equal(attachment.status, 201);
  const withAttachment = app.dispatch("GET", "/api/orders/o1", {
    token: manager,
  }).body.order.attachments;
  assert.equal(withAttachment.length, 1);
  assert.equal(withAttachment[0].title, "Смета поставщика");
  assert.equal(
    app.dispatch(
      "DELETE",
      `/api/orders/o1/attachments/${attachment.body.attachment.id}`,
      { token: admin },
    ).status,
    200,
  );
  assert.equal(
    app.dispatch("DELETE", "/api/orders/o1/attachments/a-нет", { token: admin })
      .status,
    404,
  );
});

test("11. Уведомления четырёх типов и отметка о прочтении", () => {
  const { app, login } = setup();
  const manager = login(MANAGER);
  const executor = login(EXECUTOR);
  const other = login(OTHER_EXECUTOR);

  const list = app.dispatch("GET", "/api/notifications", { token: executor });
  assert.equal(list.status, 200);
  const types = new Set(list.body.notifications.map((n) => n.type));
  for (const type of ["assigned", "overdue", "due_soon"]) {
    assert.ok(types.has(type), `у исполнителя есть уведомление типа ${type}`);
  }
  assert.ok(
    types.has("stage") ||
      app
        .dispatch("GET", "/api/notifications", { token: manager })
        .body.notifications.some((n) => n.type === "stage"),
    "менеджер видит уведомление о смене этапа",
  );

  const overdue = list.body.notifications.filter((n) => n.type === "overdue");
  assert.ok(
    overdue.every((n) => n.derived === true),
    "просрочка считается динамически по сроку этапа",
  );
  assert.equal(
    overdue.filter((n) => n.orderId === "o4").length,
    1,
    "просроченный этап даёт ровно одно уведомление исполнителю",
  );
  assert.equal(
    list.body.unread,
    list.body.notifications.length,
    "все уведомления сначала непрочитанные",
  );

  assert.equal(
    app.dispatch("POST", "/api/notifications/n-demo-2/read", {
      token: executor,
    }).status,
    404,
    "чужое уведомление не отметить",
  );
  const stored = list.body.notifications.find((n) => !n.derived);
  assert.equal(
    app.dispatch("POST", `/api/notifications/${stored.id}/read`, {
      token: executor,
    }).status,
    200,
  );
  assert.equal(
    app.dispatch("POST", "/api/notifications/read-all", { token: executor })
      .status,
    200,
  );
  const after = app.dispatch("GET", "/api/notifications", { token: executor })
    .body.notifications;
  assert.equal(
    after.filter((n) => !n.derived && !n.read).length,
    0,
    "после «прочитать всё» хранимых непрочитанных нет",
  );
  assert.equal(
    app
      .dispatch("GET", "/api/notifications", { token: other })
      .body.notifications.filter((n) => !n.derived && !n.read).length,
    1,
    "чужие уведомления не тронуты",
  );
});

test("12. Фильтры, сортировка и поиск по заказам", () => {
  const { app, login } = setup();
  const manager = login(MANAGER);
  const executor = login(EXECUTOR);

  const byStage = app.dispatch("GET", "/api/orders?stage=in_progress", {
    token: manager,
  });
  assert.equal(byStage.body.total, 7);
  assert.ok(byStage.body.orders.every((o) => o.stage === "in_progress"));

  assert.ok(
    app
      .dispatch("GET", "/api/orders?executorId=u4", { token: manager })
      .body.orders.every((o) => o.executor.id === "u4"),
  );
  assert.ok(
    app
      .dispatch("GET", "/api/orders?clientId=c1", { token: manager })
      .body.orders.every((o) => o.client.id === "c1"),
  );

  const overdue = app.dispatch("GET", "/api/orders?overdue=1", {
    token: manager,
  });
  assert.equal(
    overdue.body.total,
    4,
    "в демо-данных четыре просроченных этапа",
  );
  assert.ok(
    overdue.body.orders.every((o) => o.overdue === true && o.daysLeft < 0),
  );

  const soon = app.dispatch("GET", "/api/orders?soon=1", { token: manager });
  assert.ok(soon.body.total > 0);
  assert.ok(soon.body.orders.every((o) => o.daysLeft >= 0 && o.daysLeft <= 3));

  const sorted = app.dispatch("GET", "/api/orders?sort=amount", {
    token: manager,
  }).body.orders;
  assert.equal(sorted[0].amount, Math.min(...sorted.map((o) => o.amount)));

  assert.equal(
    app.dispatch("GET", "/api/orders?q=ЗК-1004", { token: manager }).body.total,
    1,
  );
  const byClient = app.dispatch("GET", "/api/search?q=агротрейд", {
    token: manager,
  });
  assert.equal(
    byClient.body.orders.length,
    4,
    "поиск работает по названию клиента в заказе",
  );
  assert.ok(byClient.body.orders.every((o) => o.client === "ООО «АгроТрейд»"));
  assert.equal(
    byClient.body.clients.some((c) => c.id === "c3"),
    true,
  );
  const executorSearch = app.dispatch("GET", "/api/search?q=агротрейд", {
    token: executor,
  });
  assert.equal(
    executorSearch.body.orders.length,
    1,
    "исполнитель находит только свой заказ этого клиента",
  );
  assert.equal(
    executorSearch.body.clients.length,
    0,
    "список клиентов исполнителю не показываем",
  );
  assert.equal(
    app
      .dispatch("GET", "/api/orders?scope=mine", { token: executor })
      .body.orders.every((o) => o.executor.id === "u4"),
    true,
  );
});

test("13. Видимость: исполнитель видит только свои заказы", () => {
  const { app, login } = setup();
  const manager = login(MANAGER);
  const executor = login(EXECUTOR);

  const mine = app.dispatch("GET", "/api/orders", { token: executor }).body
    .orders;
  assert.equal(mine.length, 13, "у Ильи 13 заказов");
  assert.ok(mine.every((o) => o.executor.id === "u4"));
  assert.equal(
    app.dispatch("GET", "/api/orders", { token: manager }).body.total,
    24,
    "менеджер видит все заказы агентства",
  );

  assert.equal(
    app.dispatch("GET", "/api/orders/o2", { token: executor }).status,
    403,
  );
  assert.equal(
    app.dispatch("GET", "/api/orders/o2", { token: manager }).status,
    200,
  );
  assert.equal(
    app.dispatch("GET", "/api/search?q=офисной мебели", { token: executor })
      .body.orders.length,
    0,
    "чужой заказ не находится в поиске",
  );
  assert.equal(
    app.dispatch("GET", "/api/reports/funnel", { token: executor }).status,
    403,
    "отчёты — для руководства",
  );
  assert.equal(
    app.dispatch("DELETE", "/api/orders/o1", { token: manager }).status,
    403,
  );
});

test("14. Отчёт по воронке совпадает с фактическими данными", () => {
  const { app, login } = setup();
  const manager = login(MANAGER);

  const orders = app.dispatch("GET", "/api/orders", { token: manager }).body
    .orders;
  const report = app.dispatch("GET", "/api/reports/funnel", {
    token: manager,
  }).body;
  assert.equal(report.total, orders.length);
  assert.equal(report.stages.length, STAGES.length);
  for (const stage of STAGES) {
    const row = report.stages.find((s) => s.stage === stage);
    assert.equal(
      row.count,
      orders.filter((o) => o.stage === stage).length,
      `этап ${stage}`,
    );
  }
  assert.equal(
    report.stages.reduce((sum, s) => sum + s.count, 0),
    orders.length,
  );
  assert.equal(report.stages.find((s) => s.stage === "cancelled").count, 2);
  assert.ok(
    report.stages.every(
      (s) => typeof s.title === "string" && typeof s.amount === "number",
    ),
  );
});

test("15. Среднее время на этапе считается по истории переходов", () => {
  const { app, login } = setup();
  const manager = login(MANAGER);

  const report = app.dispatch("GET", "/api/reports/stage-time", {
    token: manager,
  }).body.stages;
  const row = (stage) => report.find((s) => s.stage === stage);
  assert.equal(row("new").samples, 24, "через «Новый» прошли все 24 заказа");
  assert.equal(
    row("in_progress").samples,
    19,
    "в работе побывали все заказы, кроме новых",
  );
  assert.ok(
    row("in_progress").avgHours > 0,
    "среднее время в работе положительное",
  );
  assert.ok(row("closed").avgDays > 0);
  assert.ok(
    row("cancelled") === undefined,
    "отменённые отрезки в среднее не берём",
  );

  // Живой пересчёт: сдвигаем заказ из «Нового» в работу и возвращаем другой заказ назад.
  assert.equal(
    app.dispatch("POST", "/api/orders/o3/stage", {
      token: manager,
      body: { stage: "in_progress" },
    }).status,
    200,
  );
  const forward = app.dispatch("GET", "/api/reports/stage-time", {
    token: manager,
  }).body.stages;
  assert.equal(
    forward.find((s) => s.stage === "in_progress").samples,
    20,
    "у заказа появился отрезок «в работе»",
  );
  assert.equal(
    forward.find((s) => s.stage === "new").samples,
    24,
    "у каждого заказа ровно один отрезок «Новый»",
  );

  assert.equal(
    app.dispatch("POST", "/api/orders/o1/stage", {
      token: manager,
      body: { stage: "new", reason: "клиент вернул на доработку" },
    }).status,
    200,
  );
  const back = app.dispatch("GET", "/api/reports/stage-time", {
    token: manager,
  }).body.stages;
  assert.equal(
    back.find((s) => s.stage === "new").samples,
    25,
    "после возврата заказ прошёл через «Новый» второй раз",
  );
  assert.ok(
    report.every((r) => r.avgHours >= 0 && typeof r.avgDays === "number"),
  );
});

test("16. Загрузка исполнителей, просроченные заказы и сводный отчёт", () => {
  const { app, login } = setup();
  const manager = login(MANAGER);

  const workload = app.dispatch("GET", "/api/reports/workload", {
    token: manager,
  }).body.executors;
  assert.equal(workload.length, 2, "в агентстве два исполнителя");
  const ilya = workload.find((e) => e.id === "u4");
  const orders = app.dispatch("GET", "/api/orders?executorId=u4", {
    token: manager,
  }).body.orders;
  const active = orders.filter(
    (o) => !["done", "closed", "cancelled"].includes(o.stage),
  );
  assert.equal(
    ilya.active,
    active.length,
    "загрузка считается по фактическим активным заказам",
  );
  assert.equal(ilya.active, 10);
  assert.equal(ilya.overdue, orders.filter((o) => o.overdue).length);
  assert.equal(ilya.overdue, 3);
  assert.ok(
    ilya.load > 0 && ilya.load <= 100,
    "процент загрузки в допустимых границах",
  );

  const overdue = app.dispatch("GET", "/api/reports/overdue", {
    token: manager,
  }).body;
  assert.equal(overdue.total, 4);
  assert.ok(
    overdue.orders.every(
      (o) =>
        o.daysLeft < 0 && !["done", "closed", "cancelled"].includes(o.stage),
    ),
  );
  assert.ok(overdue.orders.every((o) => typeof o.executor?.name === "string"));

  const summary = app.dispatch("GET", "/api/reports/summary", {
    token: manager,
  }).body;
  assert.equal(summary.funnel.total, 24);
  assert.ok(
    summary.stageTime.length === STAGES.length - 1,
    "в сводке пять этапов пайплайна",
  );
  assert.equal(summary.workload.length, 2);
  assert.equal(summary.overdue.length, 4);
  assert.equal(
    app.dispatch("GET", "/api/dashboard", { token: manager }).body.counters
      .overdue,
    4,
  );
});

test("17. Назначение исполнителя: ошибки не молчат", () => {
  const { app, store, login } = setup();
  const manager = login(MANAGER);
  const orders = app.dispatch("GET", "/api/orders", { token: manager }).body
    .orders;
  const order = orders.find((o) => o.stage === "new") ?? orders[0];

  // Раньше PATCH с executorId отвечал 200 и молча ничего не менял.
  const silent = app.dispatch("PATCH", `/api/orders/${order.id}`, {
    token: manager,
    body: { executorId: "u5" },
  });
  assert.equal(
    silent.status,
    400,
    "неизвестное поле назначения отклоняется, а не игнорируется",
  );
  assert.match(silent.body.error, /assignee/);
  assert.equal(
    store.state.orders.find((o) => o.id === order.id).executorId,
    order.executorId,
    "данные не изменились",
  );

  // Снятие исполнителя: если снимать нечего, сообщение должно говорить именно об этом.
  const empty = app.dispatch("POST", `/api/orders/${order.id}/assignee`, {
    token: manager,
    body: { executorId: null },
  });
  assert.equal(
    empty.status,
    200,
    "первое снятие проходит, если исполнитель был",
  );
  const again = app.dispatch("POST", `/api/orders/${order.id}/assignee`, {
    token: manager,
    body: { executorId: null },
  });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /нет исполнителя/);

  const missing = app.dispatch("POST", `/api/orders/${order.id}/assignee`, {
    token: manager,
    body: { executorId: "нет-такого" },
  });
  assert.equal(missing.status, 404);
  const wrongRole = app.dispatch("POST", `/api/orders/${order.id}/assignee`, {
    token: manager,
    body: { executorId: "u2" },
  });
  assert.equal(wrongRole.status, 422, "менеджера исполнителем не назначают");
});

test("18. Удалённые сущности не отдают свои id новым", () => {
  const { app, login } = setup();
  const admin = login(ADMIN);
  const manager = login(MANAGER);

  const orders = app.dispatch("GET", "/api/orders", { token: manager }).body
    .orders;
  const victim = orders[orders.length - 1];
  assert.equal(
    app.dispatch("DELETE", `/api/orders/${victim.id}`, { token: admin })
      .status,
    200,
  );
  const recreated = app.dispatch("POST", "/api/orders", {
    token: manager,
    body: { title: "Новый заказ", clientId: "c1", stageDueDate: shift(5) },
  });
  assert.equal(recreated.status, 201);
  assert.notEqual(
    recreated.body.order.id,
    victim.id,
    "id удалённого заказа не переиспользуется",
  );

  const temp = app.dispatch("POST", "/api/clients", {
    token: manager,
    body: { name: "Временный клиент" },
  });
  assert.equal(temp.status, 201);
  assert.equal(
    app.dispatch("DELETE", `/api/clients/${temp.body.client.id}`, {
      token: admin,
    }).status,
    200,
  );
  const temp2 = app.dispatch("POST", "/api/clients", {
    token: manager,
    body: { name: "Временный клиент" },
  });
  assert.notEqual(
    temp2.body.client.id,
    temp.body.client.id,
    "id удалённого клиента не переиспользуется",
  );

  assert.equal(
    app.dispatch("POST", "/api/users", {
      token: admin,
      body: { name: "Без пароля", email: "nopass@tenderpulse.ru" },
    }).status,
    400,
    "пароль обязателен",
  );
});

// ТендерПульс — ядро приложения: домен, права доступа и API трекера заказов.
// Чистые функции без HTTP: server.js только передаёт сюда запросы.
// Ядро не знает про сеть, поэтому тесты вызывают dispatch напрямую, без порта.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Пайплайн этапов заказа: строго по порядку, плюс отдельная ветка «отменён».
export const PIPELINE = ["new", "in_progress", "on_review", "done", "closed"];
export const STAGES = [...PIPELINE, "cancelled"];
export const STAGE_TITLES = {
  new: "Новый",
  in_progress: "В работе",
  on_review: "На проверке",
  done: "Выполнен",
  closed: "Закрыт",
  cancelled: "Отменён",
};
// Заказ, попавший на финальный этап, дальше не двигается (кроме отменённого — его возвращают в «Новый»).
export const FINAL_STAGES = ["closed", "cancelled"];
export const ROLES = ["admin", "manager", "executor"];
export const ROLE_TITLES = {
  admin: "Администратор",
  manager: "Менеджер",
  executor: "Исполнитель",
};
export const CLIENT_STATUSES = ["active", "archived"];
// Этапы, которые исполнитель ведёт сам: постановка в работу и отправка на проверку.
export const EXECUTOR_STAGES = ["in_progress", "on_review"];

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// ---------- служебное ----------

function hashPassword(password) {
  const salt = randomBytes(8).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const round = (value, digits = 2) => Number(value.toFixed(digits));

/** Поиск не должен спотыкаться о «ё»: «оборудован» находит «Оборудование», «ё» → «е». */
const norm = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е");
/** Сколько дней осталось до срока: отрицательное число означает просрочку. */
const daysLeft = (due, today) =>
  due ? Math.ceil((startOfDay(new Date(due)) - startOfDay(today)) / DAY) : null;

/** Демонстрационные данные: агентство ведёт закупки и тендеры для клиентов. */
export function demoData(today = new Date()) {
  const day = (shift) =>
    new Date(startOfDay(today).getTime() + shift * DAY).toISOString();
  const password = hashPassword("tenderpulse");
  const users = [
    {
      id: "u1",
      name: "Анна Волкова",
      position: "Руководитель агентства",
      email: "anna@tenderpulse.ru",
      role: "admin",
    },
    {
      id: "u2",
      name: "Максим Орлов",
      position: "Ведущий менеджер по закупкам",
      email: "maxim@tenderpulse.ru",
      role: "manager",
    },
    {
      id: "u3",
      name: "Ольга Крылова",
      position: "Менеджер по работе с клиентами",
      email: "olga@tenderpulse.ru",
      role: "manager",
    },
    {
      id: "u4",
      name: "Илья Морозов",
      position: "Специалист по тендерной документации",
      email: "ilya@tenderpulse.ru",
      role: "executor",
    },
    {
      id: "u5",
      name: "Виктор Лебедев",
      position: "Аналитик цен и поставщиков",
      email: "viktor@tenderpulse.ru",
      role: "executor",
    },
  ].map((u) => ({ ...u, password, createdAt: day(-220) }));

  const clients = [
    {
      id: "c1",
      name: "ООО «Северный лес»",
      contactName: "Пётр Гаврилов",
      email: "gavrilov@sevles.ru",
      phone: "+7 812 445-11-02",
      note: "Лесозаготовка, закупки через электронные площадки.",
      status: "active",
    },
    {
      id: "c2",
      name: "АО «Гидромаш»",
      contactName: "Светлана Дёмина",
      email: "demina@gidromash.ru",
      phone: "+7 495 220-77-31",
      note: "Машиностроение, обязательные тендеры по 223-ФЗ.",
      status: "active",
    },
    {
      id: "c3",
      name: "ООО «АгроТрейд»",
      contactName: "Артём Киселёв",
      email: "kiselev@agrotrade.ru",
      phone: "+7 861 233-90-14",
      note: "Агрохолдинг, сезонные закупки расходников.",
      status: "active",
    },
    {
      id: "c4",
      name: "ГК «Медтехника Плюс»",
      contactName: "Ирина Ясная",
      email: "yasnaya@medtehplus.ru",
      phone: "+7 343 371-45-08",
      note: "Медицинское оборудование, жёсткие требования к срокам.",
      status: "active",
    },
    {
      id: "c5",
      name: "ООО «Стройинвест-4»",
      contactName: "Дмитрий Полухин",
      email: "poluhin@stroyinvest4.ru",
      phone: "+7 846 279-63-55",
      note: "Строительство дорог и инфраструктуры.",
      status: "active",
    },
    {
      id: "c6",
      name: "ЗАО «Нефтехим-Сервис»",
      contactName: "Марина Соловьёва",
      email: "soloveva@nhs.ru",
      phone: "+7 855 296-18-70",
      note: "Промышленный сервис, долгие согласования.",
      status: "archived",
    },
  ].map((c) => ({ ...c, createdAt: day(-200) }));

  // [название, клиент, менеджер, исполнитель, этап, создан (дн.), срок этапа (дн.), бюджет]
  const spec = [
    [
      "Закупка серверного оборудования по 44-ФЗ",
      "c1",
      "u2",
      "u4",
      "in_progress",
      -12,
      3,
      4800000,
    ],
    [
      "Тендер на поставку офисной мебели",
      "c2",
      "u2",
      "u5",
      "on_review",
      -18,
      1,
      1250000,
    ],
    [
      "Закупка медицинских расходников, II квартал",
      "c3",
      "u3",
      "u4",
      "new",
      -2,
      12,
      3400000,
    ],
    [
      "Подготовка документации для аукциона на ремонт дорог",
      "c4",
      "u2",
      "u4",
      "in_progress",
      -20,
      -4,
      8900000,
    ],
    [
      "Анализ поставщиков спецодежды",
      "c5",
      "u3",
      "u5",
      "done",
      -35,
      -10,
      640000,
    ],
    [
      "Закупка лицензий на систему электронного документооборота",
      "c6",
      "u2",
      "u5",
      "closed",
      -60,
      -25,
      2100000,
    ],
    [
      "Тендер на клининг офисов, годовой контракт",
      "c1",
      "u3",
      "u4",
      "on_review",
      -15,
      -2,
      1750000,
    ],
    [
      "Закупка лабораторного оборудования",
      "c3",
      "u2",
      "u5",
      "in_progress",
      -25,
      -6,
      5200000,
    ],
    ["Расчёт НМЦК по закупке топлива", "c6", "u3", "u4", "new", -1, 9, 980000],
    [
      "Поставка оргтехники для филиала",
      "c2",
      "u2",
      "u4",
      "cancelled",
      -30,
      -20,
      430000,
    ],
    [
      "Закупка систем видеонаблюдения для склада",
      "c4",
      "u3",
      "u5",
      "in_progress",
      -8,
      5,
      2600000,
    ],
    [
      "Сопровождение аукциона на поставку запчастей",
      "c5",
      "u2",
      "u4",
      "on_review",
      -10,
      4,
      1500000,
    ],
    [
      "Закупка ПО для проектирования",
      "c6",
      "u3",
      "u5",
      "done",
      -40,
      -14,
      3300000,
    ],
    [
      "Тендер на уборку снега, зимний сезон",
      "c1",
      "u2",
      "u4",
      "closed",
      -75,
      -40,
      2400000,
    ],
    [
      "Закупка оборудования для столовой",
      "c2",
      "u3",
      "u5",
      "new",
      -3,
      15,
      1100000,
    ],
    [
      "Аудит закупочной документации клиента",
      "c4",
      "u2",
      "u4",
      "in_progress",
      -6,
      2,
      760000,
    ],
    [
      "Закупка канцтоваров по рамочному контракту",
      "c3",
      "u3",
      "u5",
      "done",
      -22,
      -5,
      320000,
    ],
    [
      "Тендер на транспортные услуги",
      "c5",
      "u2",
      "u4",
      "in_progress",
      -14,
      -1,
      4100000,
    ],
    [
      "Проверка сметной документации перед аукционом",
      "c6",
      "u3",
      "u4",
      "new",
      -1,
      6,
      540000,
    ],
    [
      "Закупка спецтехники в лизинг",
      "c1",
      "u2",
      "u5",
      "on_review",
      -12,
      2,
      12500000,
    ],
    [
      "Размещение рекламы в метро на квартал",
      "c3",
      "u3",
      "u5",
      "cancelled",
      -45,
      -35,
      2900000,
    ],
    [
      "Закупка мебели для переговорных",
      "c4",
      "u2",
      "u4",
      "closed",
      -50,
      -30,
      870000,
    ],
    [
      "Тендер на охрану объектов, 12 месяцев",
      "c5",
      "u3",
      "u4",
      "in_progress",
      -5,
      7,
      6200000,
    ],
    [
      "Закупка компьютеров для учебного центра",
      "c6",
      "u2",
      "u5",
      "new",
      -4,
      10,
      3800000,
    ],
  ];

  const orders = [];
  const history = [];
  const comments = [];
  let n = 0;
  for (const [
    title,
    clientId,
    managerId,
    executorId,
    stage,
    createdShift,
    stageDueShift,
    amount,
  ] of spec) {
    n += 1;
    const id = `o${n}`;
    const number = `ЗК-${1000 + n}`;
    const path =
      stage === "cancelled"
        ? ["new", "in_progress", "cancelled"]
        : PIPELINE.slice(0, PIPELINE.indexOf(stage) + 1);
    const step =
      path.length > 1 ? (stageDueShift - createdShift) / (path.length - 1) : 0;
    const client = clients.find((c) => c.id === clientId);
    orders.push({
      id,
      number,
      title,
      description: `${title}. Закупка клиента ${client.name}: подготовка документации, проверка поставщиков и сопровождение процедуры.`,
      clientId,
      managerId,
      executorId,
      stage,
      stageDueDate: day(stageDueShift),
      dueDate: day(stageDueShift + 20),
      amount,
      createdAt: day(createdShift),
      updatedAt: day(
        Math.round(createdShift + (stageDueShift - createdShift) * 0.6),
      ),
      closedAt: stage === "closed" ? day(stageDueShift) : null,
      cancelReason:
        stage === "cancelled"
          ? "Клиент отложил закупку на следующий квартал"
          : null,
      attachments: [],
      createdBy: managerId,
    });
    history.push({
      id: `h-${id}-0`,
      orderId: id,
      userId: managerId,
      at: day(createdShift),
      field: "created",
      from: null,
      to: "new",
      note: "заказ поставлен в работу",
    });
    for (let i = 1; i < path.length; i += 1) {
      const to = path[i];
      history.push({
        id: `h-${id}-${i}`,
        orderId: id,
        userId: to === "cancelled" ? managerId : executorId,
        at: day(Math.round(createdShift + step * i)),
        field: "stage",
        from: path[i - 1],
        to,
        note: to === "cancelled" ? "клиент отказался от процедуры" : null,
      });
    }
    if (n % 3 === 0) {
      comments.push({
        id: `cm${n}-1`,
        orderId: id,
        userId: executorId,
        text: "Собрал документы по закупке, отправил на согласование менеджеру.",
        at: day(createdShift + 2),
      });
    }
    if (n % 5 === 0) {
      comments.push({
        id: `cm${n}-2`,
        orderId: id,
        userId: managerId,
        text: `Клиент (${client.contactName}) ждёт предварительную смету до конца недели.`,
        at: day(createdShift + 3),
      });
    }
    if (n % 4 === 0) {
      orders[n - 1].attachments.push({
        id: `a${n}-1`,
        title: "Техническое задание клиента",
        url: "https://drive.tenderpulse.ru/docs/tz.pdf",
        addedBy: managerId,
        at: day(createdShift + 1),
      });
    }
    if (n % 7 === 0) {
      orders[n - 1].attachments.push({
        id: `a${n}-2`,
        title: "Расчёт НМЦК",
        url: "https://drive.tenderpulse.ru/docs/nmck.xlsx",
        addedBy: executorId,
        at: day(createdShift + 2),
      });
    }
  }

  const seq = {
    users: maxSuffix(users, "u"),
    clients: maxSuffix(clients, "c"),
    orders: maxSuffix(orders, "o"),
  };

  return {
    users,
    clients,
    orders,
    history,
    comments,
    sessions: {},
    seq,
    notifications: [
      {
        id: "n-demo-1",
        userId: "u4",
        orderId: "o3",
        type: "assigned",
        text: "Вам назначен заказ ЗК-1003",
        at: day(-2),
        read: false,
      },
      {
        id: "n-demo-2",
        userId: "u5",
        orderId: "o2",
        type: "stage",
        text: "Заказ ЗК-1002 переведён на этап «На проверке»",
        at: day(-1),
        read: false,
      },
      {
        id: "n-demo-3",
        userId: "u2",
        orderId: "o5",
        type: "stage",
        text: "Заказ ЗК-1005: этап «Выполнен»",
        at: day(-3),
        read: true,
      },
    ],
  };
}

/** Хранилище: держит состояние в памяти и (опционально) сохраняет его в JSON-файл. */
export function createStore(initial, { file = null, fs = null } = {}) {
  let state = initial;
  const save = () => {
    if (file && fs) fs.writeFileSync(file, JSON.stringify(state, null, 2));
  };
  return {
    get state() {
      return state;
    },
    replace(next) {
      state = next;
      save();
    },
    save,
  };
}

// ---------- права доступа ----------

/** Максимальный числовой суффикс id вида `o12` — стартовая точка счётчика. */
function maxSuffix(items, prefix) {
  let max = 0;
  for (const it of items) {
    if (typeof it.id === "string" && it.id.startsWith(prefix)) {
      const n = Number(it.id.slice(prefix.length));
      if (Number.isInteger(n)) max = Math.max(max, n);
    }
  }
  return max;
}

/** Монотонный счётчик id: после удаления сущности id не переиспользуются,
    иначе новая сущность унаследует ссылки удалённой (заказы, комментарии, история).
    Старые хранилища без `seq` подхватываются сами: берётся максимум существующих id. */
function nextId(state, key, prefix, items) {
  if (!state.seq) state.seq = {};
  if (!Number.isInteger(state.seq[key])) {
    let max = 0;
    for (const it of items) {
      if (typeof it.id === "string" && it.id.startsWith(prefix)) {
        const n = Number(it.id.slice(prefix.length));
        if (Number.isInteger(n)) max = Math.max(max, n);
      }
    }
    state.seq[key] = max;
  }
  state.seq[key] += 1;
  return `${prefix}${state.seq[key]}`;
}

const isAdmin = (user) => user.role === "admin";
const isManager = (user) => user.role === "manager";
const isStaff = (user) => isAdmin(user) || isManager(user);
const isExecutor = (user) => user.role === "executor";
/** Исполнитель работает только со своими заказами, администратор и менеджер видят весь отдел. */
const canSeeOrder = (user, order) =>
  isStaff(user) || order.executorId === user.id;

const publicUser = (u) =>
  u
    ? {
        id: u.id,
        name: u.name,
        position: u.position,
        email: u.email,
        role: u.role,
        roleTitle: ROLE_TITLES[u.role] ?? u.role,
      }
    : null;

/** Просрочен только незавершённый этап: выполненные и закрытые заказы сроками не считаются. */
const isOverdue = (order, today) =>
  !["done", ...FINAL_STAGES].includes(order.stage) &&
  daysLeft(order.stageDueDate, today) < 0;

/**
 * Возможность перехода между этапами.
 * Разрешено: следующий этап пайплайна, возврат на предыдущий (с причиной), отмена (с причиной)
 * и возврат отменённого заказа в «Новый». Закрытый заказ — финальный, менять нельзя.
 */
function transition(from, to) {
  if (!STAGES.includes(to))
    return { ok: false, code: 400, message: "Неизвестный этап заказа" };
  if (to === from)
    return {
      ok: false,
      code: 400,
      message: `Заказ уже на этапе «${STAGE_TITLES[from]}»`,
    };
  if (from === "closed")
    return { ok: false, code: 409, message: "Закрытый заказ изменить нельзя" };
  if (to === "cancelled")
    return { ok: true, kind: "cancel", reasonRequired: true };
  if (from === "cancelled") {
    return to === "new"
      ? { ok: true, kind: "restore", reasonRequired: true }
      : {
          ok: false,
          code: 422,
          message: "Отменённый заказ можно вернуть только на этап «Новый»",
        };
  }
  const i = PIPELINE.indexOf(from);
  const j = PIPELINE.indexOf(to);
  if (j === i + 1) return { ok: true, kind: "forward" };
  if (j === i - 1) return { ok: true, kind: "backward", reasonRequired: true };
  return {
    ok: false,
    code: 422,
    message: `Нельзя перейти с этапа «${STAGE_TITLES[from]}» на «${STAGE_TITLES[to]}»`,
  };
}

// ---------- приложение ----------

export function createApp({ store, today = () => new Date() }) {
  const state = () => store.state;

  // Метка времени берётся из внедрённых часов: в тестах это фиксированная дата,
  // на сервере — реальное время. Иначе отчёты и история разъезжаются с датой расчёта.
  const stamp = () => today().toISOString();

  /** Уведомление внутри приложения (ТЗ п. 2: информирование о стадиях и сроках). */
  function notify(userId, orderId, type, text) {
    if (!userId) return;
    state().notifications.push({
      id: `nb-${randomBytes(4).toString("hex")}`,
      userId,
      orderId,
      type,
      text,
      at: stamp(),
      read: false,
    });
  }

  function writeHistory(orderId, userId, field, from, to, note = null) {
    state().history.push({
      id: `h-${randomBytes(4).toString("hex")}`,
      orderId,
      userId,
      at: stamp(),
      field,
      from,
      to,
      note,
    });
  }

  /** Всем заинтересованным, кроме автора изменения: исполнитель и менеджер заказа. */
  function notifyInterested(order, actorId, type, text) {
    for (const userId of new Set([order.executorId, order.managerId])) {
      if (userId && userId !== actorId) notify(userId, order.id, type, text);
    }
  }

  const error = (status, message) => ({ status, body: { error: message } });

  function userByToken(token) {
    const s = state();
    const userId = s.sessions[token];
    return userId ? (s.users.find((u) => u.id === userId) ?? null) : null;
  }

  const findOrder = (idOrNumber) =>
    state().orders.find(
      (o) => o.id === idOrNumber || o.number === idOrNumber,
    ) ?? null;
  const clientById = (id) => state().clients.find((c) => c.id === id) ?? null;
  const userById = (id) => state().users.find((u) => u.id === id) ?? null;

  function orderView(order, day) {
    const s = state();
    return {
      ...order,
      stageTitle: STAGE_TITLES[order.stage],
      client: clientById(order.clientId)
        ? { id: order.clientId, name: clientById(order.clientId).name }
        : null,
      manager: publicUser(userById(order.managerId)),
      executor: publicUser(userById(order.executorId)),
      overdue: isOverdue(order, day),
      daysLeft: daysLeft(order.stageDueDate, day),
      commentsCount: s.comments.filter((c) => c.orderId === order.id).length,
      attachmentsCount: order.attachments.length,
    };
  }

  /** Заказы, которые пользователь вообще вправе видеть. */
  const visibleOrders = (user) =>
    isStaff(user)
      ? state().orders
      : state().orders.filter((o) => o.executorId === user.id);

  function clientView(client) {
    const s = state();
    const day = today();
    const own = s.orders.filter((o) => o.clientId === client.id);
    return {
      ...client,
      ordersCount: own.length,
      activeCount: own.filter(
        (o) => !FINAL_STAGES.includes(o.stage) && o.stage !== "done",
      ).length,
      overdueCount: own.filter((o) => isOverdue(o, day)).length,
      amount: own.reduce((sum, o) => sum + (o.amount || 0), 0),
    };
  }

  /** Среднее время нахождения на этапе: считаем по истории переходов, текущий этап — до сегодня. */
  function stageTimeReport(orders) {
    const s = state();
    const day = today();
    const acc = Object.fromEntries(
      PIPELINE.map((stage) => [stage, { total: 0, samples: 0 }]),
    );
    for (const order of orders) {
      const events = s.history
        .filter(
          (h) =>
            h.orderId === order.id &&
            (h.field === "stage" || h.field === "created"),
        )
        .sort((a, b) => String(a.at).localeCompare(String(b.at)));
      if (!events.length) continue;
      for (let i = 0; i < events.length; i += 1) {
        const stage = i === 0 ? "new" : events[i].to;
        if (!PIPELINE.includes(stage)) continue; // отменённые отрезки в среднее по этапам не берём
        const from = new Date(events[i].at).getTime();
        const to =
          i + 1 < events.length
            ? new Date(events[i + 1].at).getTime()
            : day.getTime();
        acc[stage].total += Math.max(0, to - from) / HOUR;
        acc[stage].samples += 1;
      }
    }
    return PIPELINE.map((stage) => ({
      stage,
      title: STAGE_TITLES[stage],
      avgHours: round(
        acc[stage].samples ? acc[stage].total / acc[stage].samples : 0,
      ),
      avgDays: round(
        acc[stage].samples ? acc[stage].total / acc[stage].samples / 24 : 0,
      ),
      samples: acc[stage].samples,
    }));
  }

  function funnelReport(orders) {
    return {
      stages: STAGES.map((stage) => ({
        stage,
        title: STAGE_TITLES[stage],
        count: orders.filter((o) => o.stage === stage).length,
        amount: orders
          .filter((o) => o.stage === stage)
          .reduce((sum, o) => sum + (o.amount || 0), 0),
      })),
      total: orders.length,
    };
  }

  function workloadReport() {
    const s = state();
    const day = today();
    return s.users.filter(isExecutor).map((u) => {
      const own = s.orders.filter((o) => o.executorId === u.id);
      const active = own.filter(
        (o) => !FINAL_STAGES.includes(o.stage) && o.stage !== "done",
      );
      return {
        id: u.id,
        name: u.name,
        active: active.length,
        overdue: own.filter((o) => isOverdue(o, day)).length,
        finished: own.filter((o) => o.stage === "done" || o.stage === "closed")
          .length,
        load: Math.min(100, Math.round((active.length / 8) * 100)),
      };
    });
  }

  const overdueReport = () => {
    const day = today();
    return state()
      .orders.filter((o) => isOverdue(o, day))
      .map((o) => orderView(o, day));
  };

  // ---------- маршруты ----------
  const routes = [];
  const route = (method, pattern, handler, options = {}) => {
    routes.push({
      method,
      parts: pattern.split("/").filter(Boolean),
      handler,
      options,
    });
  };

  function dispatch(method, path, { body = {}, token = null } = {}) {
    const clean = String(path).split("?")[0];
    const query = Object.fromEntries(
      new URLSearchParams(
        String(path).includes("?") ? String(path).split("?")[1] : "",
      ),
    );
    const parts = clean.split("/").filter(Boolean);
    for (const r of routes) {
      if (r.method !== method || r.parts.length !== parts.length) continue;
      const params = {};
      let matched = true;
      for (let i = 0; i < r.parts.length; i += 1) {
        if (r.parts[i].startsWith(":"))
          params[r.parts[i].slice(1)] = decodeURIComponent(parts[i]);
        else if (r.parts[i] !== parts[i]) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      const user = token ? userByToken(token) : null;
      if (!r.options.public && !user)
        return error(401, "Требуется авторизация");
      return r.handler({ params, query, body, user, token });
    }
    return error(404, "Маршрут не найден");
  }

  // ---------- авторизация ----------
  route(
    "POST",
    "/api/login",
    ({ body }) => {
      const s = state();
      const user = s.users.find(
        (u) => u.email.toLowerCase() === String(body.email || "").toLowerCase(),
      );
      if (!user || !checkPassword(String(body.password || ""), user.password)) {
        return error(401, "Неверная почта или пароль");
      }
      const token = randomBytes(16).toString("hex");
      s.sessions[token] = user.id;
      store.save();
      return { status: 200, body: { token, user: publicUser(user) } };
    },
    { public: true },
  );

  route("POST", "/api/logout", ({ token }) => {
    delete state().sessions[token];
    store.save();
    return { status: 200, body: { ok: true } };
  });

  /** Сессия лежит в хранилище: после перезапуска сервера вход сохраняется. */
  route("GET", "/api/me", ({ user }) => ({
    status: 200,
    body: { user: publicUser(user) },
  }));

  // ---------- сотрудники ----------
  route("GET", "/api/users", ({ user }) => {
    if (!isStaff(user))
      return error(
        403,
        "Список сотрудников доступен администратору и менеджерам",
      );
    const day = today();
    return {
      status: 200,
      body: {
        users: state().users.map((u) => ({
          ...publicUser(u),
          activeOrders: state().orders.filter(
            (o) =>
              o.executorId === u.id &&
              !FINAL_STAGES.includes(o.stage) &&
              o.stage !== "done",
          ).length,
          overdueOrders: state().orders.filter(
            (o) => o.executorId === u.id && isOverdue(o, day),
          ).length,
        })),
        canCreate: isAdmin(user),
      },
    };
  });

  route("POST", "/api/users", ({ body, user }) => {
    if (!isAdmin(user)) return error(403, "Сотрудников создаёт администратор");
    const s = state();
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    if (!name || !email) return error(400, "Нужны имя и почта");
    if (s.users.some((u) => u.email.toLowerCase() === email.toLowerCase()))
      return error(409, "Такая почта уже занята");
    const password = String(body.password || "");
    if (password.length < 6)
      return error(400, "Укажите пароль не короче 6 символов");
    const created = {
      id: nextId(s, "users", "u", s.users),
      name,
      email,
      role: ROLES.includes(body.role) ? body.role : "executor",
      position: String(body.position || "").trim(),
      password: hashPassword(password),
      createdAt: stamp(),
    };
    s.users.push(created);
    store.save();
    return { status: 201, body: { user: publicUser(created) } };
  });

  route("PATCH", "/api/users/:id", ({ params, body, user }) => {
    const target = userById(params.id);
    if (!target) return error(404, "Сотрудник не найден");
    const own = target.id === user.id;
    if (!isAdmin(user) && !own)
      return error(403, "Можно править только свой профиль");
    if (
      !isAdmin(user) &&
      (body.email !== undefined || body.role !== undefined)
    ) {
      return error(403, "Почту и роль меняет администратор");
    }
    if (body.name !== undefined)
      target.name = String(body.name).trim() || target.name;
    if (body.position !== undefined)
      target.position = String(body.position).trim();
    if (body.password) target.password = hashPassword(String(body.password));
    if (isAdmin(user)) {
      if (body.email !== undefined) target.email = String(body.email).trim();
      if (body.role !== undefined && ROLES.includes(body.role))
        target.role = body.role;
    }
    store.save();
    return { status: 200, body: { user: publicUser(target) } };
  });

  route("DELETE", "/api/users/:id", ({ params, user }) => {
    if (!isAdmin(user))
      return error(403, "Удалять сотрудников может администратор");
    const s = state();
    if (params.id === user.id) return error(400, "Нельзя удалить себя");
    const target = userById(params.id);
    if (!target) return error(404, "Сотрудник не найден");
    const active = s.orders.filter(
      (o) =>
        o.executorId === params.id &&
        !FINAL_STAGES.includes(o.stage) &&
        o.stage !== "done",
    );
    if (active.length)
      return error(
        409,
        `У сотрудника ${active.length} активных заказов — сначала передайте их другому исполнителю`,
      );
    s.users = s.users.filter((u) => u.id !== params.id);
    for (const o of s.orders)
      if (o.executorId === params.id) o.executorId = null;
    store.save();
    return { status: 200, body: { ok: true } };
  });

  // ---------- клиенты ----------
  route("GET", "/api/clients", ({ user, query }) => {
    if (!isStaff(user))
      return error(403, "Список клиентов доступен администратору и менеджерам");
    let list = state().clients;
    if (query.status) list = list.filter((c) => c.status === query.status);
    if (query.q) {
      const needle = norm(query.q);
      list = list.filter(
        (c) =>
          norm(c.name).includes(needle) || norm(c.contactName).includes(needle),
      );
    }
    return {
      status: 200,
      body: { clients: list.map(clientView), canCreate: isStaff(user) },
    };
  });

  route("POST", "/api/clients", ({ body, user }) => {
    if (!isStaff(user))
      return error(403, "Клиентов создают администратор и менеджеры");
    const s = state();
    const name = String(body.name || "").trim();
    if (!name) return error(400, "Нужно название клиента");
    const client = {
      id: nextId(s, "clients", "c", s.clients),
      name,
      contactName: String(body.contactName || "").trim(),
      email: String(body.email || "").trim(),
      phone: String(body.phone || "").trim(),
      note: String(body.note || "").trim(),
      status: CLIENT_STATUSES.includes(body.status) ? body.status : "active",
      createdAt: stamp(),
    };
    s.clients.push(client);
    store.save();
    return { status: 201, body: { client: clientView(client) } };
  });

  route("GET", "/api/clients/:id", ({ params, user }) => {
    if (!isStaff(user))
      return error(
        403,
        "Карточка клиента доступна администратору и менеджерам",
      );
    const client = clientById(params.id);
    if (!client) return error(404, "Клиент не найден");
    const day = today();
    return {
      status: 200,
      body: {
        client: clientView(client),
        orders: state()
          .orders.filter((o) => o.clientId === client.id)
          .map((o) => orderView(o, day)),
      },
    };
  });

  route("PATCH", "/api/clients/:id", ({ params, body, user }) => {
    if (!isStaff(user))
      return error(403, "Клиентов правят администратор и менеджеры");
    const client = clientById(params.id);
    if (!client) return error(404, "Клиент не найден");
    for (const field of ["name", "contactName", "email", "phone", "note"]) {
      if (body[field] !== undefined) client[field] = String(body[field]).trim();
    }
    if (body.status !== undefined && CLIENT_STATUSES.includes(body.status))
      client.status = body.status;
    if (!client.name)
      return error(400, "Название клиента не может быть пустым");
    store.save();
    return { status: 200, body: { client: clientView(client) } };
  });

  route("DELETE", "/api/clients/:id", ({ params, user }) => {
    if (!isAdmin(user))
      return error(403, "Удалять клиентов может администратор");
    const s = state();
    const client = clientById(params.id);
    if (!client) return error(404, "Клиент не найден");
    const own = s.orders.filter((o) => o.clientId === params.id);
    if (own.length)
      return error(
        409,
        `У клиента ${own.length} заказов — удаление запрещено, переведите их или архивируйте клиента`,
      );
    s.clients = s.clients.filter((c) => c.id !== params.id);
    store.save();
    return { status: 200, body: { ok: true } };
  });

  // ---------- заказы ----------
  route("GET", "/api/orders", ({ user, query }) => {
    const day = today();
    let list = visibleOrders(user);
    if (query.scope === "mine")
      list = list.filter((o) => o.executorId === user.id);
    if (query.stage) list = list.filter((o) => o.stage === query.stage);
    if (query.executorId)
      list = list.filter((o) => o.executorId === query.executorId);
    if (query.managerId)
      list = list.filter((o) => o.managerId === query.managerId);
    if (query.clientId)
      list = list.filter((o) => o.clientId === query.clientId);
    if (query.overdue === "1") list = list.filter((o) => isOverdue(o, day));
    if (query.soon === "1") {
      list = list.filter((o) => {
        const left = daysLeft(o.stageDueDate, day);
        return left !== null && left >= 0 && left <= 3;
      });
    }
    if (query.due === "week") {
      list = list.filter((o) => {
        const left = daysLeft(o.dueDate, day);
        return left !== null && left >= 0 && left <= 7;
      });
    }
    if (query.q) {
      const needle = norm(query.q);
      list = list.filter((o) =>
        [o.number, o.title, o.description, clientById(o.clientId)?.name].some(
          (value) => norm(value).includes(needle),
        ),
      );
    }
    const sort = {
      stageDue: "stageDueDate",
      created: "createdAt",
      amount: "amount",
    }[query.sort];
    if (sort === "amount")
      list = list.slice().sort((a, b) => a.amount - b.amount);
    else if (sort)
      list = list
        .slice()
        .sort((a, b) => String(a[sort]).localeCompare(String(b[sort])));
    return {
      status: 200,
      body: {
        orders: list.map((o) => orderView(o, day)),
        total: list.length,
        stages: STAGES.map((stage) => ({ stage, title: STAGE_TITLES[stage] })),
      },
    };
  });

  route("POST", "/api/orders", ({ body, user }) => {
    if (!isStaff(user))
      return error(403, "Заказы создают администратор и менеджеры");
    const s = state();
    const title = String(body.title || "").trim();
    if (!title) return error(400, "Нужно название заказа");
    const client = clientById(body.clientId);
    if (!client) return error(404, "Клиент не найден");
    const stageDueDate = body.stageDueDate
      ? new Date(body.stageDueDate).toISOString()
      : null;
    if (!stageDueDate)
      return error(400, "Нужен срок текущего этапа (stageDueDate)");
    const executorId = body.executorId || null;
    if (executorId) {
      const executor = userById(executorId);
      if (!executor) return error(404, "Исполнитель не найден");
      if (!isExecutor(executor))
        return error(422, "Пользователь не является исполнителем");
    }
    const managerId = body.managerId || (isManager(user) ? user.id : null);
    if (managerId && !userById(managerId))
      return error(404, "Менеджер не найден");
    const num = s.orders.length + 1001;
    const order = {
      id: nextId(s, "orders", "o", s.orders),
      number: `ЗК-${num}`,
      title,
      description: String(body.description || ""),
      clientId: client.id,
      managerId,
      executorId,
      stage: "new",
      stageDueDate,
      dueDate: body.dueDate ? new Date(body.dueDate).toISOString() : null,
      amount: Number(body.amount) || 0,
      createdAt: stamp(),
      updatedAt: stamp(),
      closedAt: null,
      cancelReason: null,
      attachments: [],
      createdBy: user.id,
    };
    s.orders.push(order);
    writeHistory(
      order.id,
      user.id,
      "created",
      null,
      "new",
      "заказ поставлен в работу",
    );
    if (executorId)
      notify(
        executorId,
        order.id,
        "assigned",
        `Вам назначен заказ ${order.number}: ${order.title}`,
      );
    store.save();
    return { status: 201, body: { order: orderView(order, today()) } };
  });

  route("GET", "/api/orders/:id", ({ params, user }) => {
    const s = state();
    const order = findOrder(params.id);
    if (!order) return error(404, "Заказ не найден");
    if (!canSeeOrder(user, order))
      return error(403, "Заказ назначен другому исполнителю");
    const day = today();
    return {
      status: 200,
      body: {
        order: orderView(order, day),
        comments: s.comments
          .filter((c) => c.orderId === order.id)
          .map((c) => ({
            ...c,
            user: publicUser(userById(c.userId)),
            canDelete: c.userId === user.id || isAdmin(user),
          })),
        history: s.history
          .filter((h) => h.orderId === order.id)
          .sort((a, b) => String(b.at).localeCompare(String(a.at)))
          .map((h) => ({
            ...h,
            user: userById(h.userId)?.name ?? "—",
            fromTitle: h.from ? (STAGE_TITLES[h.from] ?? h.from) : null,
            toTitle: h.to ? (STAGE_TITLES[h.to] ?? h.to) : null,
          })),
        nextStages: STAGES.map((stage) => ({
          stage,
          title: STAGE_TITLES[stage],
          check: transition(order.stage, stage),
        }))
          .filter((item) => item.check.ok)
          .map(({ stage, title }) => ({ stage, title })),
        canEdit: isStaff(user),
        canChangeStage: isStaff(user) || order.executorId === user.id,
      },
    };
  });

  route("PATCH", "/api/orders/:id", ({ params, body, user }) => {
    if (!isStaff(user))
      return error(403, "Поля заказа правят администратор и менеджеры");
    const order = findOrder(params.id);
    if (!order) return error(404, "Заказ не найден");
    // Исполнителя назначают отдельной ручкой. Раньше PATCH молча игнорировал executorId
    // и всё равно отвечал 200 — клиент мог решить, что назначение прошло.
    if (body.executorId !== undefined || body.assigneeId !== undefined) {
      return error(
        400,
        "Исполнителя назначают через POST /api/orders/:id/assignee",
      );
    }
    for (const field of ["title", "description"]) {
      if (body[field] !== undefined)
        order[field] = String(body[field]).trim() || order[field];
    }
    if (body.amount !== undefined) order.amount = Number(body.amount) || 0;
    if (body.clientId !== undefined && body.clientId !== order.clientId) {
      if (!clientById(body.clientId)) return error(404, "Клиент не найден");
      writeHistory(
        order.id,
        user.id,
        "clientId",
        clientById(order.clientId)?.name ?? null,
        clientById(body.clientId).name,
        "смена клиента",
      );
      order.clientId = body.clientId;
    }
    if (body.managerId !== undefined && body.managerId !== order.managerId) {
      if (!userById(body.managerId)) return error(404, "Менеджер не найден");
      writeHistory(
        order.id,
        user.id,
        "managerId",
        order.managerId,
        body.managerId,
        "смена менеджера",
      );
      order.managerId = body.managerId;
    }
    if (body.dueDate !== undefined)
      order.dueDate = body.dueDate
        ? new Date(body.dueDate).toISOString()
        : null;
    if (body.stageDueDate !== undefined) {
      const next = body.stageDueDate
        ? new Date(body.stageDueDate).toISOString()
        : null;
      if (next !== order.stageDueDate) {
        writeHistory(
          order.id,
          user.id,
          "stageDueDate",
          order.stageDueDate,
          next,
          "изменён срок этапа",
        );
        notifyInterested(
          order,
          user.id,
          "deadline",
          `По заказу ${order.number} изменён срок этапа`,
        );
        order.stageDueDate = next;
      }
    }
    order.updatedAt = stamp();
    store.save();
    return { status: 200, body: { order: orderView(order, today()) } };
  });

  route("DELETE", "/api/orders/:id", ({ params, user }) => {
    if (!isAdmin(user)) return error(403, "Удалять заказы может администратор");
    const s = state();
    const order = findOrder(params.id);
    if (!order) return error(404, "Заказ не найден");
    s.orders = s.orders.filter((o) => o.id !== order.id);
    s.history = s.history.filter((h) => h.orderId !== order.id);
    s.comments = s.comments.filter((c) => c.orderId !== order.id);
    s.notifications = s.notifications.filter((n) => n.orderId !== order.id);
    store.save();
    return { status: 200, body: { ok: true } };
  });

  /** Назначение и снятие исполнителя. */
  route("POST", "/api/orders/:id/assignee", ({ params, body, user }) => {
    if (!isStaff(user))
      return error(403, "Назначает исполнителя администратор или менеджер");
    const order = findOrder(params.id);
    if (!order) return error(404, "Заказ не найден");
    const executorId = body.executorId || null;
    if (executorId === order.executorId) {
      return error(
        400,
        executorId
          ? "Этот исполнитель уже назначен на заказ"
          : "У заказа нет исполнителя — снимать нечего",
      );
    }
    if (executorId) {
      const executor = userById(executorId);
      if (!executor) return error(404, "Исполнитель не найден");
      if (!isExecutor(executor))
        return error(422, "Пользователь не является исполнителем");
    }
    const previous = order.executorId;
    order.executorId = executorId;
    order.updatedAt = stamp();
    writeHistory(
      order.id,
      user.id,
      "executorId",
      previous ? (userById(previous)?.name ?? previous) : null,
      executorId ? userById(executorId).name : null,
      executorId ? "назначен исполнитель" : "исполнитель снят",
    );
    if (executorId)
      notify(
        executorId,
        order.id,
        "assigned",
        `Вам назначен заказ ${order.number}: ${order.title}`,
      );
    if (previous)
      notify(
        previous,
        order.id,
        "assigned",
        `Заказ ${order.number} снят с вас и передан другому исполнителю`,
      );
    store.save();
    return { status: 200, body: { order: orderView(order, today()) } };
  });

  /** Смена этапа: проверка перехода, история, уведомления и новый срок этапа. */
  route("POST", "/api/orders/:id/stage", ({ params, body, user }) => {
    const order = findOrder(params.id);
    if (!order) return error(404, "Заказ не найден");
    if (!canSeeOrder(user, order))
      return error(403, "Заказ назначен другому исполнителю");
    const target = String(body.stage || "");
    const check = transition(order.stage, target);
    if (!check.ok) return error(check.code, check.message);
    if (!isStaff(user)) {
      // Исполнитель ведёт свой заказ сам, но не закрывает и не отменяет его.
      if (order.executorId !== user.id)
        return error(403, "Заказ назначен другому исполнителю");
      if (!EXECUTOR_STAGES.includes(target)) {
        return error(
          403,
          `Исполнитель может перевести заказ только на этап «В работе» или «На проверке»`,
        );
      }
    }
    const reason = String(body.reason || "").trim();
    if (check.reasonRequired && !reason) {
      return error(
        400,
        check.kind === "cancel"
          ? "Нужна причина отмены заказа"
          : "Нужна причина возврата на предыдущий этап",
      );
    }
    const previous = order.stage;
    if (body.stageDueDate === undefined) {
      // По умолчанию новый этап получает срок через 5 дней — трекер не оставляет этап без дедлайна.
      order.stageDueDate = new Date(
        startOfDay(today()).getTime() + 5 * DAY,
      ).toISOString();
    } else {
      order.stageDueDate = body.stageDueDate
        ? new Date(body.stageDueDate).toISOString()
        : null;
    }
    order.stage = target;
    order.updatedAt = stamp();
    if (target === "closed") order.closedAt = stamp();
    if (target === "cancelled") order.cancelReason = reason;
    if (target === "new" && previous === "cancelled") order.cancelReason = null;
    writeHistory(order.id, user.id, "stage", previous, target, reason || null);
    notifyInterested(
      order,
      user.id,
      "stage",
      `Заказ ${order.number}: этап «${STAGE_TITLES[previous]}» → «${STAGE_TITLES[target]}»`,
    );
    if (target === "new")
      notifyInterested(
        order,
        user.id,
        "assigned",
        `Заказ ${order.number} возвращён в работу`,
      );
    store.save();
    return {
      status: 200,
      body: {
        order: orderView(order, today()),
        previousStage: previous,
        reason: reason || null,
        stageDueDate: order.stageDueDate,
      },
    };
  });

  // ---------- комментарии и вложения ----------
  route("POST", "/api/orders/:id/comments", ({ params, body, user }) => {
    const s = state();
    const order = findOrder(params.id);
    if (!order) return error(404, "Заказ не найден");
    if (!canSeeOrder(user, order))
      return error(403, "Заказ назначен другому исполнителю");
    const text = String(body.text || "").trim();
    if (!text) return error(400, "Текст комментария пуст");
    const comment = {
      id: `cm-${randomBytes(4).toString("hex")}`,
      orderId: order.id,
      userId: user.id,
      text,
      at: stamp(),
    };
    s.comments.push(comment);
    notifyInterested(
      order,
      user.id,
      "comment",
      `Новый комментарий по заказу ${order.number}`,
    );
    store.save();
    return {
      status: 201,
      body: { comment: { ...comment, user: publicUser(user) } },
    };
  });

  route("PATCH", "/api/comments/:id", ({ params, body, user }) => {
    const s = state();
    const comment = s.comments.find((c) => c.id === params.id);
    if (!comment) return error(404, "Комментарий не найден");
    if (comment.userId !== user.id)
      return error(403, "Править можно только свои комментарии");
    const text = String(body.text || "").trim();
    if (!text) return error(400, "Текст комментария пуст");
    comment.text = text;
    comment.editedAt = stamp();
    store.save();
    return { status: 200, body: { comment } };
  });

  route("DELETE", "/api/comments/:id", ({ params, user }) => {
    const s = state();
    const comment = s.comments.find((c) => c.id === params.id);
    if (!comment) return error(404, "Комментарий не найден");
    if (comment.userId !== user.id && !isAdmin(user))
      return error(
        403,
        "Удалять можно свои комментарии, администратор — любые",
      );
    s.comments = s.comments.filter((c) => c.id !== params.id);
    store.save();
    return { status: 200, body: { ok: true } };
  });

  route("POST", "/api/orders/:id/attachments", ({ params, body, user }) => {
    const order = findOrder(params.id);
    if (!order) return error(404, "Заказ не найден");
    if (!canSeeOrder(user, order))
      return error(403, "Заказ назначен другому исполнителю");
    const url = String(body.url || "").trim();
    const title = String(body.title || "").trim();
    if (!title) return error(400, "Нужно название вложения");
    if (!/^https?:\/\/\S+$/i.test(url))
      return error(400, "Ссылка должна начинаться с http:// или https://");
    const attachment = {
      id: `a-${randomBytes(4).toString("hex")}`,
      title,
      url,
      addedBy: user.id,
      at: stamp(),
    };
    order.attachments.push(attachment);
    order.updatedAt = stamp();
    writeHistory(
      order.id,
      user.id,
      "attachment",
      null,
      title,
      "добавлено вложение",
    );
    store.save();
    return { status: 201, body: { attachment } };
  });

  route(
    "DELETE",
    "/api/orders/:id/attachments/:attachmentId",
    ({ params, user }) => {
      const order = findOrder(params.id);
      if (!order) return error(404, "Заказ не найден");
      if (!canSeeOrder(user, order))
        return error(403, "Заказ назначен другому исполнителю");
      const attachment = order.attachments.find(
        (a) => a.id === params.attachmentId,
      );
      if (!attachment) return error(404, "Вложение не найдено");
      if (attachment.addedBy !== user.id && !isAdmin(user))
        return error(403, "Удалять можно свои вложения, администратор — любые");
      order.attachments = order.attachments.filter(
        (a) => a.id !== params.attachmentId,
      );
      store.save();
      return { status: 200, body: { ok: true } };
    },
  );

  // ---------- уведомления ----------
  route("GET", "/api/notifications", ({ user }) => {
    const s = state();
    const day = today();
    // Сроки считаются на лету: «приближается срок этапа» и «этап просрочен».
    const derived = s.orders
      .filter((o) => o.executorId === user.id || o.managerId === user.id)
      .flatMap((o) => {
        const left = daysLeft(o.stageDueDate, day);
        if (left === null || ["done", ...FINAL_STAGES].includes(o.stage))
          return [];
        if (left < 0) {
          return [
            {
              id: `due-over-${o.id}`,
              userId: user.id,
              orderId: o.id,
              type: "overdue",
              text: `Просрочен этап «${STAGE_TITLES[o.stage]}» по заказу ${o.number}`,
              at: o.stageDueDate,
              read: false,
              derived: true,
            },
          ];
        }
        if (left <= 2) {
          return [
            {
              id: `due-soon-${o.id}`,
              userId: user.id,
              orderId: o.id,
              type: "due_soon",
              text: `Срок этапа «${STAGE_TITLES[o.stage]}» по заказу ${o.number} — через ${left} дн.`,
              at: o.stageDueDate,
              read: false,
              derived: true,
            },
          ];
        }
        return [];
      });
    const own = s.notifications.filter((n) => n.userId === user.id);
    const all = [...derived, ...own].sort((a, b) =>
      String(b.at).localeCompare(String(a.at)),
    );
    return {
      status: 200,
      body: {
        notifications: all,
        unread: all.filter((n) => !n.read).length,
        types: {
          assigned: "Назначение заказа",
          stage: "Смена этапа",
          due_soon: "Приближается срок",
          overdue: "Этап просрочен",
          comment: "Комментарий",
          deadline: "Изменён срок",
        },
      },
    };
  });

  route("POST", "/api/notifications/:id/read", ({ params, user }) => {
    const s = state();
    const item = s.notifications.find(
      (n) => n.id === params.id && n.userId === user.id,
    );
    if (!item) return error(404, "Уведомление не найдено");
    item.read = true;
    store.save();
    return { status: 200, body: { ok: true } };
  });

  route("POST", "/api/notifications/read-all", ({ user }) => {
    for (const n of state().notifications)
      if (n.userId === user.id) n.read = true;
    store.save();
    return { status: 200, body: { ok: true } };
  });

  // ---------- отчёты ----------
  route("GET", "/api/reports/funnel", ({ user }) => {
    if (!isStaff(user))
      return error(403, "Отчёты доступны администратору и менеджерам");
    return { status: 200, body: funnelReport(state().orders) };
  });

  route("GET", "/api/reports/stage-time", ({ user }) => {
    if (!isStaff(user))
      return error(403, "Отчёты доступны администратору и менеджерам");
    return { status: 200, body: { stages: stageTimeReport(state().orders) } };
  });

  route("GET", "/api/reports/workload", ({ user }) => {
    if (!isStaff(user))
      return error(403, "Отчёты доступны администратору и менеджерам");
    return { status: 200, body: { executors: workloadReport() } };
  });

  route("GET", "/api/reports/overdue", ({ user }) => {
    if (!isStaff(user))
      return error(403, "Отчёты доступны администратору и менеджерам");
    const list = overdueReport();
    return { status: 200, body: { orders: list, total: list.length } };
  });

  route("GET", "/api/reports/summary", ({ user }) => {
    if (!isStaff(user))
      return error(403, "Отчёты доступны администратору и менеджерам");
    const day = today();
    const orders = state().orders;
    return {
      status: 200,
      body: {
        funnel: funnelReport(orders),
        stageTime: stageTimeReport(orders),
        workload: workloadReport(),
        overdue: overdueReport().map((o) => ({
          id: o.id,
          number: o.number,
          title: o.title,
          stage: o.stage,
          stageDueDate: o.stageDueDate,
          executor: o.executor?.name ?? null,
          daysLeft: daysLeft(o.stageDueDate, day),
        })),
      },
    };
  });

  // ---------- главная и поиск ----------
  route("GET", "/api/dashboard", ({ user }) => {
    const s = state();
    const day = today();
    const mine = visibleOrders(user);
    const active = mine.filter((o) => !FINAL_STAGES.includes(o.stage));
    return {
      status: 200,
      body: {
        counters: {
          total: mine.length,
          active:
            active.length - active.filter((o) => o.stage === "done").length,
          onReview: mine.filter((o) => o.stage === "on_review").length,
          overdue: mine.filter((o) => isOverdue(o, day)).length,
          closed: mine.filter((o) => o.stage === "closed").length,
        },
        upcoming: active
          .slice()
          .sort((a, b) =>
            String(a.stageDueDate).localeCompare(String(b.stageDueDate)),
          )
          .slice(0, 5)
          .map((o) => ({
            id: o.id,
            number: o.number,
            title: o.title,
            stage: o.stage,
            stageTitle: STAGE_TITLES[o.stage],
            stageDueDate: o.stageDueDate,
            daysLeft: daysLeft(o.stageDueDate, day),
            overdue: isOverdue(o, day),
          })),
        funnel: funnelReport(mine).stages,
        recent: s.history
          .filter((h) => mine.some((o) => o.id === h.orderId))
          .slice(-6)
          .toReversed()
          .map((h) => ({
            orderId: h.orderId,
            at: h.at,
            user: userById(h.userId)?.name ?? "—",
            text:
              h.field === "stage"
                ? `этап «${STAGE_TITLES[h.from]}» → «${STAGE_TITLES[h.to]}»`
                : `${h.field}: ${h.from ?? "—"} → ${h.to ?? "—"}`,
          })),
        reports: isStaff(user),
      },
    };
  });

  route("GET", "/api/search", ({ user, query }) => {
    const needle = norm(query.q).trim();
    if (!needle) return { status: 200, body: { orders: [], clients: [] } };
    const day = today();
    const orders = visibleOrders(user)
      .filter((o) =>
        [o.number, o.title, o.description, clientById(o.clientId)?.name].some(
          (value) => norm(value).includes(needle),
        ),
      )
      .slice(0, 20)
      .map((o) => ({
        id: o.id,
        number: o.number,
        title: o.title,
        stage: o.stage,
        stageTitle: STAGE_TITLES[o.stage],
        client: clientById(o.clientId)?.name ?? null,
        overdue: isOverdue(o, day),
      }));
    const clients = isStaff(user)
      ? state()
          .clients.filter(
            (c) =>
              norm(c.name).includes(needle) ||
              norm(c.contactName).includes(needle),
          )
          .map((c) => ({ id: c.id, name: c.name }))
      : [];
    return { status: 200, body: { orders, clients } };
  });

  return { dispatch, STAGES, STAGE_TITLES, PIPELINE, ROLES, ROLE_TITLES };
}

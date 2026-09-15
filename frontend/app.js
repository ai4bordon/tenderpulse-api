/* ТендерПульс, веб-пульт. Токен хранится только в памяти. */

const STAGE_ORDER = [
  "new",
  "in_progress",
  "on_review",
  "done",
  "closed",
  "cancelled",
];

const S = {
  token: null,
  user: null,
  route: "home",
  orders: [],
  ordersFilter: {
    stage: "",
    executorId: "",
    clientId: "",
    overdue: false,
    soon: false,
    q: "",
    sort: "stageDue",
  },
  clients: [],
  users: [],
  summary: null,
  dashboard: null,
  notif: [],
  notifUnread: 0,
  clientSel: null,
  drawerOrder: null,
};

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function esc(v) {
  return String(v == null ? "" : v).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

/* Единственная точка вставки HTML: все динамические значения выше уже
   экранированы через esc(), сырых вставок в коде нет. */
function setHTML(el, s) {
  el.innerHTML = s;
}

function fmtMoney(v) {
  if (v == null || v === "") return "0 ₽";
  return new Intl.NumberFormat("ru-RU").format(Number(v) || 0) + " ₽";
}

function fmtDate(iso) {
  if (!iso) return "нет срока";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "нет срока";
  const p = (n) => String(n).padStart(2, "0");
  return p(d.getDate()) + "." + p(d.getMonth() + 1) + "." + d.getFullYear();
}

function toInputDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function plusDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toInputDate(d.toISOString());
}

function fmtLeft(days) {
  if (days == null) return "без срока";
  if (days < 0) return "просрочка " + Math.abs(days) + " дн.";
  if (days === 0) return "срок сегодня";
  return "осталось " + days + " дн.";
}

function stageTag(stage, title) {
  return (
    '<span class="stage-tag st-' + esc(stage) + '">' + esc(title) + "</span>"
  );
}

function toast(msg, isErr) {
  const box = $("#toasts");
  const el = document.createElement("p");
  el.className = "toastmsg" + (isErr ? " err" : "");
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

/* ---------- API ---------- */
async function api(method, path, body) {
  const opt = { method, headers: { "Content-Type": "application/json" } };
  if (S.token) opt.headers["X-Token"] = S.token;
  if (body !== undefined) opt.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(API_BASE + path, opt);
  } catch {
    throw {
      http: 0,
      message: "Нет соединения с сервером. Проверьте сеть и нажмите повтор.",
    };
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok)
    throw {
      http: res.status,
      message: (data && data.error) || "Ошибка " + res.status,
    };
  return data;
}

function stateBox(text, retry) {
  const id = "retry-" + Math.floor(Math.random() * 1e6);
  return (
    '<div class="statebox"><p>' +
    esc(text) +
    "</p>" +
    (retry
      ? '<div class="actions"><button class="btn btn-outline-secondary" type="button" id="' +
        id +
        '">Повторить</button></div>'
      : "") +
    "</div>"
  );
}

function bindRetry(html, host, fn) {
  setHTML(host, html);
  const b = host.querySelector("[id^=retry-]");
  if (b) b.addEventListener("click", fn);
}

function isStaff() {
  return S.user && (S.user.role === "admin" || S.user.role === "manager");
}
function isAdmin() {
  return S.user && S.user.role === "admin";
}

/* ---------- вход ---------- */
function showLogin(err) {
  $("#login-view").hidden = false;
  $("#app").hidden = true;
  closeDrawer();
  if (err) {
    const e = $("#login-error");
    e.textContent = err;
    e.hidden = false;
  }
}

function showApp() {
  $("#login-view").hidden = true;
  $("#app").hidden = false;
  $("#who").textContent = S.user.name + ", " + S.user.roleTitle;
  $$("[data-staff]").forEach((b) => {
    b.hidden = !isStaff();
  });
  if (!isStaff() && S.route === "clients") S.route = "home";
  markNav();
  refreshBell();
  render();
}

async function doLogin(email, password) {
  const err = $("#login-error");
  err.hidden = true;
  const btn = $("#login-submit");
  btn.disabled = true;
  btn.textContent = "Входим...";
  try {
    const data = await api("POST", "/api/login", { email, password });
    S.token = data.token;
    S.user = data.user;
    $("#login-password").value = "";
    showApp();
  } catch (e) {
    $("#login-password").value = "";
    err.textContent = e.http === 401 ? "Неверная почта или пароль" : e.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Войти";
  }
}

/* ---------- навигация ---------- */
function markNav() {
  $$(".navbtn").forEach((b) => {
    if (b.dataset.route === S.route) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  $$("[data-view]").forEach((v) => {
    v.hidden = v.dataset.view !== S.route;
  });
}

function go(route) {
  if (route === "clients" && !isStaff()) {
    toast("Раздел клиентов доступен менеджеру и администратору", true);
    return;
  }
  S.route = route;
  if (location.hash !== "#/" + route) location.hash = "#/" + route;
  markNav();
  render();
}

function render() {
  if (S.route === "home") renderHome($("#view-home"));
  else if (S.route === "orders") renderOrders($("#view-orders"));
  else if (S.route === "clients") renderClients($("#view-clients"));
  else if (S.route === "notify") renderNotify($("#view-notify"));
}

/* ---------- SVG: воронка ---------- */
function funnelSVG(stages, total, activeStage) {
  const W = 560,
    rowH = 44,
    pad = 8;
  const max = Math.max(1, ...stages.map((s) => s.count));
  let y = pad;
  let out = "";
  stages.forEach((s) => {
    const w = Math.max(56, Math.round((s.count / max) * (W - 220)));
    const act = activeStage === s.stage ? " active" : "";
    out +=
      '<g class="funnel-step' +
      act +
      '" data-stage="' +
      esc(s.stage) +
      '" tabindex="0" role="button" aria-label="Этап ' +
      esc(s.title) +
      ": " +
      s.count +
      ' заказов. Фильтровать заказы.">' +
      '<text class="cap" x="0" y="' +
      (y + 19) +
      '">' +
      esc(s.title) +
      "</text>" +
      '<rect class="bar" x="150" y="' +
      y +
      '" width="' +
      w +
      '" height="32">' +
      "<title>" +
      esc(s.title) +
      ": " +
      s.count +
      "</title></rect>" +
      '<text x="' +
      158 +
      '" y="' +
      (y + 21) +
      '">' +
      s.count +
      " · " +
      esc(fmtMoney(s.amount)) +
      "</text>" +
      "</g>";
    y += rowH;
  });
  const H = y + pad - 12;
  void total;
  return (
    '<svg class="funnel-svg" viewBox="0 0 ' +
    W +
    " " +
    H +
    '" role="img" aria-label="Воронка заказов по этапам">' +
    out +
    "</svg>"
  );
}

function stageTimeSVG(rows) {
  const W = 560,
    rowH = 34,
    pad = 4;
  const max = Math.max(0.01, ...rows.map((r) => r.avgDays));
  let y = pad;
  let out = "";
  rows.forEach((r) => {
    const w = Math.max(3, Math.round((r.avgDays / max) * (W - 250)));
    out +=
      "<g>" +
      '<text x="0" y="' +
      (y + 15) +
      '">' +
      esc(r.title) +
      "</text>" +
      '<rect class="track" x="150" y="' +
      y +
      '" width="' +
      (W - 250) +
      '" height="16"></rect>' +
      '<rect class="fill" x="150" y="' +
      y +
      '" width="' +
      w +
      '" height="16"><title>' +
      esc(r.title) +
      ": " +
      r.avgDays +
      " дн.</title></rect>" +
      '<text class="mono" x="' +
      (W - 92) +
      '" y="' +
      (y + 14) +
      '">' +
      r.avgDays +
      " дн.</text>" +
      "</g>";
    y += rowH;
  });
  return (
    '<svg class="bars-svg" viewBox="0 0 ' +
    W +
    " " +
    y +
    '" role="img" aria-label="Среднее время на этапе в днях">' +
    out +
    "</svg>"
  );
}

/* ---------- главная ---------- */
async function renderHome(host) {
  setHTML(
    host,
    '<div class="viewhead"><h1>Главная</h1></div><div class="statebox"><p>Загружаем сводку...</p></div>',
  );
  try {
    const [dash, sum] = await Promise.all([
      api("GET", "/api/dashboard"),
      isStaff()
        ? api("GET", "/api/reports/summary").catch(() => null)
        : Promise.resolve(null),
    ]);
    S.dashboard = dash;
    S.summary = sum;
  } catch (e) {
    bindRetry(
      stateBox(e.http === 403 ? "Нет доступа к сводке." : e.message, true),
      host,
      () => renderHome(host),
    );
    return;
  }
  const d = S.dashboard;
  const c = d.counters;
  const funnel =
    (S.summary && S.summary.funnel && S.summary.funnel.stages) ||
    d.funnel ||
    [];
  const stageTime = (S.summary && S.summary.stageTime) || [];
  const workload = (S.summary && S.summary.workload) || [];
  const overdue = (S.summary && S.summary.overdue) || null;

  let h =
    '<div class="viewhead"><h1>Главная</h1><span class="muted">Что в работе, что горит, кто занят</span></div>';
  h +=
    '<div class="counters" role="list">' +
    counter("Всего заказов", c.total, "") +
    counter("В работе", c.active, "") +
    counter("На проверке", c.onReview, "") +
    counter("Просрочено", c.overdue, c.overdue ? "alert" : "") +
    counter("Закрыто", c.closed, "") +
    "</div>";

  h +=
    '<div class="grid2"><div class="panel"><h2>Воронка этапов</h2>' +
    (funnel.length
      ? funnelSVG(funnel, d.counters.total, S.ordersFilter.stage || null) +
        '<p class="muted funnel-hint">Нажмите на этап, чтобы отфильтровать заказы.</p>'
      : "<p>Данных пока нет.</p>") +
    "</div><div class='panel'><h2>Среднее время на этапе</h2>";
  if (stageTime.length) h += stageTimeSVG(stageTime);
  else if (isStaff()) h += "<p>Данных пока нет.</p>";
  else
    h +=
      "<p>Среднее время видят менеджер и администратор. Ниже ваши ближайшие сроки.</p>";
  h += "</div></div>";

  h +=
    '<div class="panel"><h2>Ближайшие сроки этапов</h2>' +
    upcomingTable(d.upcoming) +
    "</div>";

  if (isStaff() && workload.length) {
    h +=
      '<div class="panel"><h2>Загрузка исполнителей</h2><div class="tablewrap" style="max-height:300px"><table class="data"><caption class="visually-hidden">Загрузка исполнителей</caption>' +
      "<thead><tr><th scope='col'>Исполнитель</th><th scope='col' class='num'>Активных</th><th scope='col' class='num'>Просрочено</th><th scope='col' class='num'>Завершено</th></tr></thead><tbody>" +
      workload
        .map(
          (w) =>
            "<tr><td>" +
            esc(w.name) +
            "</td><td class='num mono'>" +
            w.active +
            "</td><td class='num mono" +
            (w.overdue ? " signal" : "") +
            "'>" +
            w.overdue +
            "</td><td class='num mono'>" +
            w.finished +
            "</td></tr>",
        )
        .join("") +
      "</tbody></table></div></div>";
  }

  h +=
    '<div class="panel"><h2>Просроченные заказы</h2>' +
    overdueTable(overdue) +
    "</div>";

  if (d.recent && d.recent.length) {
    h +=
      '<div class="panel"><h2>Последние события</h2><ul class="hist">' +
      d.recent
        .map(
          (r) =>
            '<li><span class="mono">' +
            esc(fmtDate(r.at)) +
            "</span> " +
            esc(r.user) +
            ": " +
            esc(r.text) +
            " (<a href='#' data-open-order='" +
            esc(r.orderId) +
            "'>открыть заказ</a>)</li>",
        )
        .join("") +
      "</ul></div>";
  }
  setHTML(host, h);

  $$(".funnel-step", host).forEach((g) => {
    const pick = () => {
      const st = g.dataset.stage;
      S.ordersFilter.stage = S.ordersFilter.stage === st ? "" : st;
      go("orders");
    };
    g.addEventListener("click", pick);
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pick();
      }
    });
  });
  $$("[data-open-order]", host).forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      openOrder(a.dataset.openOrder);
    }),
  );
  $$("[data-overdue-open]", host).forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      openOrder(a.dataset.overdueOpen);
    }),
  );
}

function counter(label, v, cls) {
  return (
    '<div class="counter ' +
    cls +
    '" role="listitem"><div class="v mono">' +
    v +
    '</div><div class="l">' +
    esc(label) +
    "</div></div>"
  );
}

function upcomingTable(rows) {
  if (!rows || !rows.length)
    return "<p>Ближайших сроков нет. Все этапы закрыты или без даты.</p>";
  return (
    '<div class="tablewrap" style="max-height:320px"><table class="data"><caption class="visually-hidden">Ближайшие сроки этапов</caption>' +
    "<thead><tr><th scope='col'>Номер</th><th scope='col'>Заказ</th><th scope='col'>Этап</th><th scope='col' class='num'>Срок</th><th scope='col'>Остаток</th></tr></thead><tbody>" +
    rows
      .map(
        (o) =>
          "<tr class='rowlink" +
          (o.overdue ? " is-overdue" : "") +
          "' data-open-order='" +
          esc(o.id) +
          "' tabindex='0'>" +
          "<td class='mono'>" +
          esc(o.number) +
          "</td><td>" +
          esc(o.title) +
          "</td><td>" +
          stageTag(o.stage, o.stageTitle) +
          "</td>" +
          "<td class='num mono'>" +
          esc(fmtDate(o.stageDueDate)) +
          "</td>" +
          "<td class='" +
          (o.overdue ? "overdue-flag" : "") +
          "'>" +
          esc(fmtLeft(o.daysLeft)) +
          "</td></tr>",
      )
      .join("") +
    "</tbody></table></div>"
  );
}

function overdueTable(pre) {
  const render = (rows) => {
    if (!rows.length) return "<p>Просрочек нет. Все этапы идут по сроку.</p>";
    return (
      '<div class="tablewrap" style="max-height:320px"><table class="data"><caption class="visually-hidden">Просроченные заказы</caption>' +
      "<thead><tr><th scope='col'>Номер</th><th scope='col'>Заказ</th><th scope='col'>Этап</th><th scope='col'>Исполнитель</th><th scope='col' class='num'>Срок</th></tr></thead><tbody>" +
      rows
        .map((o) => {
          const ex = o.executor
            ? o.executor.name
            : o.executorName || "не назначен";
          return (
            "<tr class='rowlink is-overdue' data-overdue-open='" +
            esc(o.id) +
            "' tabindex='0'>" +
            "<td class='mono'>" +
            esc(o.number) +
            "</td><td>" +
            esc(o.title) +
            "</td><td>" +
            stageTag(o.stage, o.stageTitle || o.stage) +
            "</td>" +
            "<td>" +
            esc(ex) +
            "</td><td class='num mono signal'>" +
            esc(fmtDate(o.stageDueDate)) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>"
    );
  };
  if (pre) return render(pre);
  const liveId = "overdue-live";
  api("GET", "/api/orders?overdue=1&sort=stageDue").then(
    (d) => {
      const el = document.getElementById(liveId);
      if (el) {
        setHTML(el, render(d.orders));
        bindRows(el);
      }
    },
    (e) => {
      const el = document.getElementById(liveId);
      if (el) setHTML(el, "<p>" + esc(e.message) + "</p>");
    },
  );
  return '<div id="' + liveId + '"><p>Загружаем...</p></div>';
}

/* ---------- заказы ---------- */
function filterQuery() {
  const f = S.ordersFilter;
  const q = new URLSearchParams();
  if (f.stage) q.set("stage", f.stage);
  if (f.executorId) q.set("executorId", f.executorId);
  if (f.clientId) q.set("clientId", f.clientId);
  if (f.overdue) q.set("overdue", "1");
  if (f.soon) q.set("soon", "1");
  if (f.q) q.set("q", f.q);
  q.set("sort", f.sort || "stageDue");
  return "/api/orders?" + q.toString();
}

async function renderOrders(host) {
  const f = S.ordersFilter;
  let h = '<div class="viewhead"><h1>Заказы</h1>';
  if (isStaff())
    h +=
      '<button class="btn btn-primary" type="button" id="new-order-btn"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg> Новый заказ</button>';
  h += "</div>";
  h +=
    '<form class="filters panel" id="orders-filters" aria-label="Фильтры заказов">' +
    '<div class="fld"><label for="f-stage">Этап</label><select class="form-select" id="f-stage"><option value="">Все этапы</option>' +
    STAGE_ORDER.map(
      (s) =>
        '<option value="' +
        s +
        '"' +
        (f.stage === s ? " selected" : "") +
        ">" +
        esc(stageTitle(s)) +
        "</option>",
    ).join("") +
    "</select></div>" +
    (isStaff()
      ? '<div class="fld"><label for="f-exec">Исполнитель</label><select class="form-select" id="f-exec"><option value="">Все</option></select></div>'
      : "") +
    (isStaff()
      ? '<div class="fld"><label for="f-client">Клиент</label><select class="form-select" id="f-client"><option value="">Все</option></select></div>'
      : "") +
    '<div class="fld"><label for="f-q">Поиск</label><input class="form-control" id="f-q" type="search" value="' +
    esc(f.q) +
    '" placeholder="Номер, название, клиент"></div>' +
    '<div class="fld"><label for="f-sort">Сортировка</label><select class="form-select" id="f-sort">' +
    [
      ["stageDue", "По сроку этапа"],
      ["created", "По созданию"],
      ["amount", "По бюджету"],
    ]
      .map(
        ([v, t]) =>
          '<option value="' +
          v +
          '"' +
          (f.sort === v ? " selected" : "") +
          ">" +
          t +
          "</option>",
      )
      .join("") +
    "</select></div>" +
    '<label class="checkline"><input type="checkbox" id="f-overdue"' +
    (f.overdue ? " checked" : "") +
    "> Только просроченные</label>" +
    '<label class="checkline"><input type="checkbox" id="f-soon"' +
    (f.soon ? " checked" : "") +
    "> Срок до 3 дней</label>" +
    '<button class="btn btn-outline-secondary" type="button" id="f-reset">Сбросить</button>' +
    "</form>";
  h +=
    '<div id="orders-list"><div class="statebox"><p>Загружаем заказы...</p></div></div>';
  setHTML(host, h);

  if (isStaff()) {
    try {
      const [ud, cd] = await Promise.all([
        api("GET", "/api/users"),
        api("GET", "/api/clients"),
      ]);
      S.users = ud.users;
      S.clients = cd.clients;
      const ex = $("#f-exec");
      if (ex)
        setHTML(
          ex,
          '<option value="">Все</option>' +
            ud.users
              .filter((u) => u.role === "executor")
              .map(
                (u) =>
                  '<option value="' +
                  u.id +
                  '"' +
                  (f.executorId === u.id ? " selected" : "") +
                  ">" +
                  esc(u.name) +
                  "</option>",
              )
              .join(""),
        );
      const cl = $("#f-client");
      if (cl)
        setHTML(
          cl,
          '<option value="">Все</option>' +
            cd.clients
              .map(
                (c) =>
                  '<option value="' +
                  c.id +
                  '"' +
                  (f.clientId === c.id ? " selected" : "") +
                  ">" +
                  esc(c.name) +
                  "</option>",
              )
              .join(""),
        );
    } catch {
      /* фильтры по справочникам необязательны */
    }
  }

  const form = $("#orders-filters");
  form.addEventListener("submit", (e) => e.preventDefault());
  const apply = () => {
    f.stage = $("#f-stage").value;
    f.executorId = $("#f-exec") ? $("#f-exec").value : "";
    f.clientId = $("#f-client") ? $("#f-client").value : "";
    f.q = $("#f-q").value.trim();
    f.sort = $("#f-sort").value;
    f.overdue = $("#f-overdue").checked;
    f.soon = $("#f-soon").checked;
    loadOrders();
  };
  ["f-stage", "f-exec", "f-client", "f-sort", "f-overdue", "f-soon"].forEach(
    (id) => {
      const el = $("#" + id);
      if (el) el.addEventListener("change", apply);
    },
  );
  let deb = null;
  $("#f-q").addEventListener("input", () => {
    clearTimeout(deb);
    deb = setTimeout(apply, 350);
  });
  $("#f-reset").addEventListener("click", () => {
    S.ordersFilter = {
      stage: "",
      executorId: "",
      clientId: "",
      overdue: false,
      soon: false,
      q: "",
      sort: "stageDue",
    };
    renderOrders(host);
  });
  const nb = $("#new-order-btn");
  if (nb) nb.addEventListener("click", openCreateModal);
  loadOrders();
}

function stageTitle(s) {
  return (
    {
      new: "Новый",
      in_progress: "В работе",
      on_review: "На проверке",
      done: "Выполнен",
      closed: "Закрыт",
      cancelled: "Отменён",
    }[s] || s
  );
}

async function loadOrders() {
  const box = $("#orders-list");
  setHTML(box, '<div class="statebox"><p>Загружаем заказы...</p></div>');
  try {
    const data = await api("GET", filterQuery());
    S.orders = data.orders;
  } catch (e) {
    bindRetry(stateBox(e.message, true), box, loadOrders);
    return;
  }
  if (!S.orders.length) {
    const filtered =
      S.ordersFilter.stage ||
      S.ordersFilter.q ||
      S.ordersFilter.overdue ||
      S.ordersFilter.clientId ||
      S.ordersFilter.executorId;
    setHTML(
      box,
      '<div class="statebox"><p>' +
        (filtered
          ? "Под фильтры ничего не попало. Сбросьте фильтры."
          : "Заказов пока нет.") +
        "</p>" +
        (filtered
          ? '<div class="actions"><button class="btn btn-outline-secondary" type="button" id="orders-clear">Сбросить фильтры</button></div>'
          : "") +
        "</div>",
    );
    const c = $("#orders-clear");
    if (c)
      c.addEventListener("click", () => {
        S.ordersFilter = {
          stage: "",
          executorId: "",
          clientId: "",
          overdue: false,
          soon: false,
          q: "",
          sort: "stageDue",
        };
        renderOrders($("#view-orders"));
      });
    return;
  }
  let h =
    '<div class="tablewrap"><table class="data"><caption>Заказы: ' +
    S.orders.length +
    "</caption>" +
    "<thead><tr><th scope='col'>Номер</th><th scope='col'>Название</th><th scope='col'>Клиент</th><th scope='col'>Этап</th><th scope='col'>Исполнитель</th><th scope='col' class='num'>Срок этапа</th><th scope='col' class='num'>Сумма</th></tr></thead><tbody>";
  S.orders.forEach((o) => {
    h +=
      "<tr class='rowlink" +
      (o.overdue ? " is-overdue" : "") +
      "' data-order='" +
      esc(o.id) +
      "' tabindex='0'>" +
      "<td class='mono'>" +
      esc(o.number) +
      "</td><td>" +
      esc(o.title) +
      "</td>" +
      "<td>" +
      esc(o.client ? o.client.name : "нет") +
      "</td>" +
      "<td>" +
      stageTag(o.stage, o.stageTitle) +
      (o.overdue ? ' <span class="overdue-flag">просрочка</span>' : "") +
      "</td>" +
      "<td>" +
      esc(o.executor ? o.executor.name : "не назначен") +
      "</td>" +
      "<td class='num mono" +
      (o.overdue ? " signal" : "") +
      "'>" +
      esc(fmtDate(o.stageDueDate)) +
      "</td>" +
      "<td class='num mono'>" +
      esc(fmtMoney(o.amount)) +
      "</td></tr>";
  });
  setHTML(box, h + "</tbody></table></div>");
  bindRows(box);
}

function bindRows(root) {
  $$("[data-open-order], [data-order]", root).forEach((r) => {
    const open = () => openOrder(r.dataset.openOrder || r.dataset.order);
    r.addEventListener("click", open);
    r.addEventListener("keydown", (e) => {
      if (e.key === "Enter") open();
    });
  });
}

/* ---------- drawer заказа ---------- */
function closeDrawer() {
  $("#drawer").hidden = true;
  $("#drawer-scrim").hidden = true;
  S.drawerOrder = null;
}

async function openOrder(id) {
  const body = $("#drawer-body");
  $("#drawer").hidden = false;
  $("#drawer-scrim").hidden = false;
  $("#drawer-title").textContent = "Загрузка...";
  setHTML(body, '<div class="statebox"><p>Загружаем заказ...</p></div>');
  $("#drawer-close").focus();
  try {
    const data = await api("GET", "/api/orders/" + encodeURIComponent(id));
    S.drawerOrder = data;
    renderDrawer(data);
  } catch (e) {
    $("#drawer-title").textContent = "Заказ недоступен";
    setHTML(
      body,
      stateBox(
        e.http === 403
          ? "Заказ назначен другому исполнителю. У вас нет доступа."
          : e.http === 404
            ? "Заказ не найден. Возможно, его удалили."
            : e.message,
        false,
      ),
    );
  }
}

function needsReason(from, to) {
  if (to === "cancelled") return true;
  if (from === "cancelled" && to === "new") return true;
  const i = STAGE_ORDER.indexOf(from),
    j = STAGE_ORDER.indexOf(to);
  return j === i - 1;
}

function renderDrawer(d) {
  const o = d.order;
  $("#drawer-title").textContent = o.number + " " + o.title;
  const body = $("#drawer-body");
  let h = "";
  if (o.overdue)
    h +=
      '<p class="overdue-flag">Этап просрочен: ' +
      esc(fmtLeft(o.daysLeft)) +
      "</p>";
  h +=
    "<dl class='kv'>" +
    kv("Клиент", o.client ? esc(o.client.name) : "нет") +
    kv("Этап", stageTag(o.stage, o.stageTitle)) +
    kv(
      "Срок этапа",
      '<span class="mono' +
        (o.overdue ? " signal" : "") +
        '">' +
        esc(fmtDate(o.stageDueDate)) +
        "</span> (" +
        esc(fmtLeft(o.daysLeft)) +
        ")",
    ) +
    kv(
      "Общий срок",
      '<span class="mono">' + esc(fmtDate(o.dueDate)) + "</span>",
    ) +
    kv("Исполнитель", esc(o.executor ? o.executor.name : "не назначен")) +
    kv("Менеджер", esc(o.manager ? o.manager.name : "не указан")) +
    kv("Бюджет", '<span class="mono">' + esc(fmtMoney(o.amount)) + "</span>") +
    (o.cancelReason ? kv("Причина отмены", esc(o.cancelReason)) : "") +
    "</dl>";
  if (o.description) h += "<p>" + esc(o.description) + "</p>";

  /* степпер и смена этапа */
  h +=
    "<h3>Этап</h3><ol class='stepper'>" +
    STAGE_ORDER.filter((s) => s !== "cancelled")
      .map((s) => {
        const idx = STAGE_ORDER.indexOf(s),
          cur = STAGE_ORDER.indexOf(o.stage);
        const cls =
          s === o.stage
            ? "cur"
            : idx < cur || o.stage === "closed"
              ? "past"
              : "";
        return (
          "<li class='" +
          cls +
          "'><span class='dot' aria-hidden='true'></span><span>" +
          esc(stageTitle(s)) +
          (s === o.stage ? " (текущий)" : "") +
          "</span></li>"
        );
      })
      .join("") +
    "</ol>";
  if (o.stage === "cancelled")
    h += "<p>Заказ отменён. Вернуть можно только на этап Новый с причиной.</p>";

  if (d.canChangeStage && d.nextStages && d.nextStages.length) {
    h +=
      "<form id='stage-form'><div class='mb-2'><label class='form-label' for='stage-to'>Перевести на этап</label><select class='form-select' id='stage-to'>" +
      d.nextStages
        .map(
          (s) =>
            "<option value='" +
            esc(s.stage) +
            "'>" +
            esc(s.title) +
            (needsReason(o.stage, s.stage) ? " (нужна причина)" : "") +
            "</option>",
        )
        .join("") +
      "</select></div>" +
      "<div class='mb-2'><label class='form-label' for='stage-due'>Новый срок этапа</label><input class='form-control mono' id='stage-due' type='date' value='" +
      plusDays(5) +
      "'></div>" +
      "<div class='mb-2'><label class='form-label' for='stage-reason'>Причина (для возврата и отмены обязательна)</label><input class='form-control' id='stage-reason' placeholder='Что случилось'></div>" +
      "<p class='form-error' id='stage-error' role='alert' hidden></p>" +
      "<button class='btn btn-primary' type='submit' id='stage-submit'>Сменить этап</button></form>";
  } else if (d.canChangeStage) {
    h +=
      "<p class='muted'>Переходов с этого этапа нет. Закрытый заказ изменить нельзя.</p>";
  }

  /* исполнитель */
  if (d.canEdit) {
    h +=
      "<h3>Исполнитель</h3><form id='assign-form'><div class='mb-2'><label class='form-label' for='assign-sel'>Назначить</label><select class='form-select' id='assign-sel'><option value=''>Снять исполнителя</option></select></div>" +
      "<p class='form-error' id='assign-error' role='alert' hidden></p><button class='btn btn-outline-secondary' type='submit'>Назначить</button></form>";
  }

  /* правка полей */
  if (d.canEdit) {
    h +=
      "<h3>Поля заказа</h3><form id='edit-form'>" +
      "<div class='mb-2'><label class='form-label' for='e-title'>Название</label><input class='form-control' id='e-title' value='" +
      esc(o.title) +
      "'></div>" +
      "<div class='mb-2'><label class='form-label' for='e-desc'>Описание</label><textarea class='form-control' id='e-desc' rows='2'>" +
      esc(o.description || "") +
      "</textarea></div>" +
      "<div class='row'><div class='col-6 mb-2'><label class='form-label' for='e-amount'>Бюджет, ₽</label><input class='form-control mono' id='e-amount' type='number' min='0' value='" +
      (o.amount || 0) +
      "'></div>" +
      "<div class='col-6 mb-2'><label class='form-label' for='e-due'>Общий срок</label><input class='form-control mono' id='e-due' type='date' value='" +
      esc(toInputDate(o.dueDate)) +
      "'></div></div>" +
      "<div class='mb-2'><label class='form-label' for='e-stage-due'>Срок этапа</label><input class='form-control mono' id='e-stage-due' type='date' value='" +
      esc(toInputDate(o.stageDueDate)) +
      "'></div>" +
      "<p class='form-error' id='edit-error' role='alert' hidden></p><button class='btn btn-outline-secondary' type='submit'>Сохранить поля</button></form>";
  }

  /* комментарии */
  h += "<h3>Комментарии (" + d.comments.length + ")</h3><div id='comments'>";
  if (!d.comments.length) h += "<p class='muted'>Комментариев пока нет.</p>";
  d.comments.forEach((c) => {
    const mine = S.user && c.userId === S.user.id;
    h +=
      "<div class='comment'><p class='meta'>" +
      esc(c.user ? c.user.name : "сотрудник") +
      " · <span class='mono'>" +
      esc(fmtDate(c.at)) +
      "</span>" +
      (c.editedAt ? " · правлен" : "") +
      "</p>" +
      "<p data-ctext='" +
      esc(c.id) +
      "'>" +
      esc(c.text) +
      "</p>" +
      (mine || isAdmin()
        ? "<div class='ops'>" +
          (mine
            ? "<button class='btn btn-outline-secondary mini' type='button' data-cedit='" +
              esc(c.id) +
              "'>Править</button>"
            : "") +
          "<button class='btn btn-outline-secondary mini' type='button' data-cdel='" +
          esc(c.id) +
          "'>Удалить</button></div>"
        : "") +
      "</div>";
  });
  h +=
    "</div><form id='comment-form'><div class='mb-2'><label class='form-label' for='comment-text'>Новый комментарий</label><textarea class='form-control' id='comment-text' rows='2' required></textarea></div>" +
    "<p class='form-error' id='comment-error' role='alert' hidden></p><button class='btn btn-outline-secondary' type='submit'>Добавить</button></form>";

  /* вложения */
  h += "<h3>Вложения-ссылки (" + o.attachments.length + ")</h3>";
  if (!o.attachments.length) h += "<p class='muted'>Ссылок пока нет.</p>";
  h +=
    "<ul>" +
    o.attachments
      .map(
        (a) =>
          "<li><a href='" +
          esc(a.url) +
          "' target='_blank' rel='noopener'>" +
          esc(a.title) +
          "</a> " +
          "<button class='btn btn-outline-secondary mini' type='button' data-adel='" +
          esc(a.id) +
          "' aria-label='Удалить вложение " +
          esc(a.title) +
          "'>Удалить</button></li>",
      )
      .join("") +
    "</ul>";
  h +=
    "<form id='attach-form'><div class='mb-2'><label class='form-label' for='att-title'>Название ссылки</label><input class='form-control' id='att-title' required></div>" +
    "<div class='mb-2'><label class='form-label' for='att-url'>Адрес (с http:// или https://)</label><input class='form-control' id='att-url' type='url' placeholder='https://' required></div>" +
    "<p class='form-error' id='attach-error' role='alert' hidden></p><button class='btn btn-outline-secondary' type='submit'>Добавить ссылку</button></form>";

  /* история */
  h += "<h3>История</h3>";
  if (d.history.length)
    h +=
      "<ul class='hist'>" +
      d.history
        .map(
          (ev) =>
            "<li><span class='mono'>" +
            esc(fmtDate(ev.at)) +
            "</span> " +
            esc(ev.user) +
            ": " +
            esc(histText(ev)) +
            "</li>",
        )
        .join("") +
      "</ul>";
  else h += "<p class='muted'>Записей пока нет.</p>";

  if (isAdmin())
    h +=
      "<h3>Опасная зона</h3><button class='btn btn-outline-secondary' type='button' id='order-del'>Удалить заказ</button>";

  setHTML(body, h);
  wireDrawer(d);
}

function kv(k, v) {
  return "<dt>" + esc(k) + "</dt><dd>" + v + "</dd>";
}

function histText(ev) {
  if (ev.field === "stage")
    return (
      "этап " +
      (ev.fromTitle || ev.from || "") +
      " → " +
      (ev.toTitle || ev.to || "") +
      (ev.note ? " (" + ev.note + ")" : "")
    );
  if (ev.field === "created") return "заказ поставлен в работу";
  const names = {
    stageDueDate: "срок этапа",
    executorId: "исполнитель",
    managerId: "менеджер",
    clientId: "клиент",
    attachment: "вложение",
    dueDate: "общий срок",
  };
  return (
    (names[ev.field] || ev.field) +
    ": " +
    (ev.from || "нет") +
    " → " +
    (ev.to || "нет") +
    (ev.note ? " (" + ev.note + ")" : "")
  );
}

function wireDrawer(d) {
  const o = d.order;
  const reload = () => openOrder(o.id);

  const sf = $("#stage-form");
  if (sf)
    sf.addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#stage-error");
      err.hidden = true;
      const to = $("#stage-to").value;
      const due = $("#stage-due").value;
      const reason = $("#stage-reason").value.trim();
      if (needsReason(o.stage, to) && !reason) {
        err.textContent =
          to === "cancelled"
            ? "Нужна причина отмены заказа"
            : "Нужна причина возврата на предыдущий этап";
        err.hidden = false;
        return;
      }
      const btn = $("#stage-submit");
      btn.disabled = true;
      btn.textContent = "Меняем...";
      try {
        await api("POST", "/api/orders/" + o.id + "/stage", {
          stage: to,
          reason: reason || undefined,
          stageDueDate: due ? new Date(due).toISOString() : undefined,
        });
        toast("Этап сменен: " + stageTitle(to));
        reload();
        renderHomeIfVisible();
        loadOrdersIfVisible();
        refreshBell();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = "Сменить этап";
      }
    });

  const af = $("#assign-form");
  if (af) {
    api("GET", "/api/users").then(
      (ud) => {
        const sel = $("#assign-sel");
        if (!sel) return;
        setHTML(
          sel,
          "<option value=''>Снять исполнителя</option>" +
            ud.users
              .filter((u) => u.role === "executor")
              .map(
                (u) =>
                  "<option value='" +
                  u.id +
                  "'" +
                  (o.executorId === u.id ? " selected" : "") +
                  ">" +
                  esc(u.name) +
                  "</option>",
              )
              .join(""),
        );
      },
      () => {
        const er = $("#assign-error");
        if (er) {
          er.textContent = "Не удалось загрузить сотрудников";
          er.hidden = false;
        }
      },
    );
    af.addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#assign-error");
      err.hidden = true;
      const v = $("#assign-sel").value || null;
      try {
        await api("POST", "/api/orders/" + o.id + "/assignee", {
          executorId: v,
        });
        toast(v ? "Исполнитель назначен" : "Исполнитель снят");
        reload();
        loadOrdersIfVisible();
        refreshBell();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    });
  }

  const ef = $("#edit-form");
  if (ef)
    ef.addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#edit-error");
      err.hidden = true;
      const payload = {
        title: $("#e-title").value.trim(),
        description: $("#e-desc").value,
        amount: Number($("#e-amount").value) || 0,
        dueDate: $("#e-due").value
          ? new Date($("#e-due").value).toISOString()
          : null,
        stageDueDate: $("#e-stage-due").value
          ? new Date($("#e-stage-due").value).toISOString()
          : null,
      };
      if (!payload.title) {
        err.textContent = "Нужно название заказа";
        err.hidden = false;
        return;
      }
      try {
        await api("PATCH", "/api/orders/" + o.id, payload);
        toast("Поля сохранены");
        reload();
        loadOrdersIfVisible();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    });

  $("#comment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#comment-error");
    err.hidden = true;
    const t = $("#comment-text").value.trim();
    if (!t) {
      err.textContent = "Текст комментария пуст";
      err.hidden = false;
      return;
    }
    try {
      await api("POST", "/api/orders/" + o.id + "/comments", { text: t });
      reload();
      loadOrdersIfVisible();
      refreshBell();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  $$("[data-cdel]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("Удалить комментарий?")) return;
      try {
        await api("DELETE", "/api/comments/" + b.dataset.cdel);
        reload();
      } catch (ex) {
        toast(ex.message, true);
      }
    }),
  );

  $$("[data-cedit]").forEach((b) =>
    b.addEventListener("click", async () => {
      const p = document.querySelector(
        "[data-ctext='" + b.dataset.cedit + "']",
      );
      const cur = p ? p.textContent : "";
      const next = prompt("Текст комментария:", cur);
      if (next == null) return;
      if (!next.trim()) {
        toast("Текст комментария пуст", true);
        return;
      }
      try {
        await api("PATCH", "/api/comments/" + b.dataset.cedit, {
          text: next.trim(),
        });
        reload();
      } catch (ex) {
        toast(ex.message, true);
      }
    }),
  );

  $("#attach-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#attach-error");
    err.hidden = true;
    const title = $("#att-title").value.trim();
    const url = $("#att-url").value.trim();
    if (!title) {
      err.textContent = "Нужно название вложения";
      err.hidden = false;
      return;
    }
    if (!/^https?:\/\/\S+$/i.test(url)) {
      err.textContent = "Ссылка должна начинаться с http:// или https://";
      err.hidden = false;
      return;
    }
    try {
      await api("POST", "/api/orders/" + o.id + "/attachments", { title, url });
      toast("Ссылка добавлена");
      reload();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  $$("[data-adel]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("Удалить вложение?")) return;
      try {
        await api(
          "DELETE",
          "/api/orders/" + o.id + "/attachments/" + b.dataset.adel,
        );
        reload();
      } catch (ex) {
        toast(ex.message, true);
      }
    }),
  );

  const del = $("#order-del");
  if (del)
    del.addEventListener("click", async () => {
      if (!confirm("Удалить заказ " + o.number + " без возврата?")) return;
      try {
        await api("DELETE", "/api/orders/" + o.id);
        closeDrawer();
        toast("Заказ удален");
        renderHomeIfVisible();
        loadOrdersIfVisible();
        refreshBell();
      } catch (ex) {
        toast(ex.message, true);
      }
    });
}

function renderHomeIfVisible() {
  if (S.route === "home") renderHome($("#view-home"));
}
function loadOrdersIfVisible() {
  if (S.route === "orders") loadOrders();
}

/* ---------- создание заказа ---------- */
async function openCreateModal() {
  const err = $("#nc-error");
  err.hidden = true;
  $("#order-create-form").reset();
  $("#nc-stage-due").value = plusDays(5);
  try {
    const [cd, ud] = await Promise.all([
      api("GET", "/api/clients"),
      api("GET", "/api/users"),
    ]);
    setHTML(
      $("#nc-client"),
      "<option value=''>Выберите клиента</option>" +
        cd.clients
          .filter((c) => c.status === "active")
          .map(
            (c) => "<option value='" + c.id + "'>" + esc(c.name) + "</option>",
          )
          .join(""),
    );
    setHTML(
      $("#nc-exec"),
      "<option value=''>Пока без исполнителя</option>" +
        ud.users
          .filter((u) => u.role === "executor")
          .map(
            (u) => "<option value='" + u.id + "'>" + esc(u.name) + "</option>",
          )
          .join(""),
    );
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
  bootstrap.Modal.getOrCreateInstance($("#order-modal")).show();
}

/* ---------- клиенты ---------- */
async function renderClients(host) {
  setHTML(
    host,
    '<div class="viewhead"><h1>Клиенты</h1><button class="btn btn-primary" type="button" id="new-client-btn"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg> Новый клиент</button></div><div id="clients-list"><div class="statebox"><p>Загружаем клиентов...</p></div></div>',
  );
  $("#new-client-btn").addEventListener("click", () => openClientModal(null));
  const box = $("#clients-list");
  try {
    const data = await api("GET", "/api/clients");
    S.clients = data.clients;
  } catch (e) {
    bindRetry(stateBox(e.message, true), box, () => renderClients(host));
    return;
  }
  if (!S.clients.length) {
    setHTML(
      box,
      '<div class="statebox"><p>Клиентов пока нет. Заведите первого.</p></div>',
    );
    return;
  }
  let h =
    '<div class="tablewrap"><table class="data"><caption>Клиенты: ' +
    S.clients.length +
    "</caption>" +
    "<thead><tr><th scope='col'>Название</th><th scope='col'>Контакт</th><th scope='col' class='num'>Заказов</th><th scope='col' class='num'>Активных</th><th scope='col' class='num'>Просрочено</th><th scope='col' class='num'>Сумма</th><th scope='col'>Статус</th></tr></thead><tbody>";
  S.clients.forEach((c) => {
    h +=
      "<tr class='rowlink' data-client='" +
      esc(c.id) +
      "' tabindex='0'><td>" +
      esc(c.name) +
      "</td>" +
      "<td>" +
      esc([c.contactName, c.phone].filter(Boolean).join(", ") || "нет") +
      "</td>" +
      "<td class='num mono'>" +
      c.ordersCount +
      "</td><td class='num mono'>" +
      c.activeCount +
      "</td>" +
      "<td class='num mono" +
      (c.overdueCount ? " signal" : "") +
      "'>" +
      c.overdueCount +
      "</td>" +
      "<td class='num mono'>" +
      esc(fmtMoney(c.amount)) +
      "</td>" +
      "<td>" +
      (c.status === "active" ? "активен" : "в архиве") +
      "</td></tr>";
  });
  setHTML(box, h + "</tbody></table></div><div id='client-card'></div>");
  $$("[data-client]", box).forEach((r) => {
    const open = () => openClientCard(r.dataset.client);
    r.addEventListener("click", open);
    r.addEventListener("keydown", (e) => {
      if (e.key === "Enter") open();
    });
  });
}

async function openClientCard(id) {
  const box = $("#client-card");
  setHTML(box, '<div class="statebox"><p>Загружаем карточку...</p></div>');
  let data;
  try {
    data = await api("GET", "/api/clients/" + encodeURIComponent(id));
  } catch (e) {
    setHTML(box, stateBox(e.message, false));
    return;
  }
  const c = data.client;
  let h =
    "<div class='panel'><h2>" +
    esc(c.name) +
    "</h2><dl class='kv'>" +
    kv(
      "Контакт",
      esc(
        [c.contactName, c.email, c.phone].filter(Boolean).join(", ") || "нет",
      ),
    ) +
    kv("Статус", c.status === "active" ? "активен" : "в архиве") +
    kv(
      "Заказов",
      '<span class="mono">' +
        c.ordersCount +
        "</span>, активных " +
        c.activeCount +
        ", просрочено " +
        c.overdueCount,
    ) +
    kv(
      "Сумма бюджетов",
      '<span class="mono">' + esc(fmtMoney(c.amount)) + "</span>",
    ) +
    "</dl>";
  if (c.note) h += "<p>" + esc(c.note) + "</p>";
  h +=
    "<div class='actions' style='display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px'>" +
    "<button class='btn btn-outline-secondary' type='button' id='cc-edit'>Править</button>" +
    (isAdmin()
      ? "<button class='btn btn-outline-secondary' type='button' id='cc-del'>Удалить</button>"
      : "") +
    "</div>";
  if (data.orders.length) {
    h +=
      '<div class="tablewrap" style="max-height:300px"><table class="data"><caption>Заказы клиента</caption><thead><tr><th scope="col">Номер</th><th scope="col">Заказ</th><th scope="col">Этап</th><th scope="col" class="num">Срок</th></tr></thead><tbody>' +
      data.orders
        .map(
          (o) =>
            "<tr class='rowlink" +
            (o.overdue ? " is-overdue" : "") +
            "' data-cc-order='" +
            esc(o.id) +
            "' tabindex='0'><td class='mono'>" +
            esc(o.number) +
            "</td><td>" +
            esc(o.title) +
            "</td><td>" +
            stageTag(o.stage, o.stageTitle) +
            "</td><td class='num mono'>" +
            esc(fmtDate(o.stageDueDate)) +
            "</td></tr>",
        )
        .join("") +
      "</tbody></table></div>";
  } else h += "<p class='muted'>У клиента пока нет заказов.</p>";
  setHTML(box, h + "</div>");
  $("#cc-edit").addEventListener("click", () => openClientModal(c));
  const del = $("#cc-del");
  if (del)
    del.addEventListener("click", async () => {
      if (!confirm("Удалить клиента " + c.name + "?")) return;
      try {
        await api("DELETE", "/api/clients/" + c.id);
        toast("Клиент удален");
        renderClients($("#view-clients"));
      } catch (e) {
        toast(e.message, true);
      }
    });
  $$("[data-cc-order]", box).forEach((r) =>
    r.addEventListener("click", () => openOrder(r.dataset.ccOrder)),
  );
}

function openClientModal(c) {
  const err = $("#cf-error");
  err.hidden = true;
  $("#client-modal-title").textContent = c ? "Править клиента" : "Новый клиент";
  $("#cf-id").value = c ? c.id : "";
  $("#cf-name").value = c ? c.name : "";
  $("#cf-contact").value = c ? c.contactName || "" : "";
  $("#cf-status").value = c ? c.status : "active";
  $("#cf-email").value = c ? c.email || "" : "";
  $("#cf-phone").value = c ? c.phone || "" : "";
  $("#cf-note").value = c ? c.note || "" : "";
  bootstrap.Modal.getOrCreateInstance($("#client-modal")).show();
}

/* ---------- уведомления ---------- */
async function renderNotify(host) {
  setHTML(
    host,
    '<div class="viewhead"><h1>Уведомления</h1><button class="btn btn-outline-secondary" type="button" id="notif-all">Прочитать все</button></div><div id="notif-list"><div class="statebox"><p>Загружаем...</p></div></div>',
  );
  $("#notif-all").addEventListener("click", async () => {
    try {
      await api("POST", "/api/notifications/read-all");
      refreshBell();
      renderNotify(host);
    } catch (e) {
      toast(e.message, true);
    }
  });
  const box = $("#notif-list");
  try {
    const data = await api("GET", "/api/notifications");
    S.notif = data.notifications;
    S.notifUnread = data.unread;
  } catch (e) {
    bindRetry(stateBox(e.message, true), box, () => renderNotify(host));
    return;
  }
  if (!S.notif.length) {
    setHTML(box, '<div class="statebox"><p>Уведомлений нет.</p></div>');
    return;
  }
  const titles = {
    assigned: "Назначение",
    stage: "Этап",
    deadline: "Срок",
    comment: "Комментарий",
    due_soon: "Скоро срок",
    overdue: "Просрочка",
  };
  setHTML(
    box,
    S.notif
      .map(
        (n) =>
          "<div class='comment" +
          (n.read ? "" : " sig-bg") +
          "'><p class='meta'>" +
          esc(titles[n.type] || n.type) +
          " · <span class='mono'>" +
          esc(fmtDate(n.at)) +
          "</span>" +
          (n.read ? "" : " · новое") +
          "</p>" +
          "<p>" +
          esc(n.text) +
          "</p><div class='ops'>" +
          (n.orderId
            ? "<button class='btn btn-outline-secondary mini' type='button' data-nopen='" +
              esc(n.orderId) +
              "'>Открыть заказ</button>"
            : "") +
          (!n.read && !n.derived
            ? "<button class='btn btn-outline-secondary mini' type='button' data-nread='" +
              esc(n.id) +
              "'>Прочитано</button>"
            : "") +
          "</div></div>",
      )
      .join(""),
  );
  $$("[data-nopen]", box).forEach((b) =>
    b.addEventListener("click", () => openOrder(b.dataset.nopen)),
  );
  $$("[data-nread]", box).forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await api(
          "POST",
          "/api/notifications/" + encodeURIComponent(b.dataset.nread) + "/read",
        );
        refreshBell();
        renderNotify(host);
      } catch (e) {
        toast(e.message, true);
      }
    }),
  );
}

async function refreshBell() {
  if (!S.token) return;
  try {
    const data = await api("GET", "/api/notifications");
    S.notifUnread = data.unread;
    const b = $("#bell-count");
    b.textContent = data.unread;
    b.hidden = !data.unread;
    $("#bell").setAttribute(
      "aria-label",
      "Уведомления" + (data.unread ? ", непрочитанных: " + data.unread : ""),
    );
  } catch {
    /* колокол необязателен */
  }
}

/* ---------- глобальный поиск ---------- */
async function topSearch(q) {
  const box = $("#topsearch-results");
  if (!q.trim()) {
    box.hidden = true;
    box.textContent = "";
    return;
  }
  let data;
  try {
    data = await api("GET", "/api/search?q=" + encodeURIComponent(q.trim()));
  } catch (e) {
    setHTML(box, "<p style='padding:10px 16px'>" + esc(e.message) + "</p>");
    box.hidden = false;
    return;
  }
  if (!data.orders.length && !data.clients.length) {
    setHTML(box, "<p style='padding:10px 16px'>Ничего не найдено.</p>");
    box.hidden = false;
    return;
  }
  setHTML(
    box,
    data.orders
      .map(
        (o) =>
          "<button type='button' data-sorder='" +
          esc(o.id) +
          "'><span class='mono'>" +
          esc(o.number) +
          "</span> " +
          esc(o.title) +
          " · " +
          esc(o.stageTitle) +
          "</button>",
      )
      .join("") +
      data.clients
        .map(
          (c) =>
            "<button type='button' data-sclient='" +
            esc(c.id) +
            "'>Клиент: " +
            esc(c.name) +
            "</button>",
        )
        .join(""),
  );
  box.hidden = false;
  $$("[data-sorder]", box).forEach((b) =>
    b.addEventListener("click", () => {
      box.hidden = true;
      openOrder(b.dataset.sorder);
    }),
  );
  $$("[data-sclient]", box).forEach((b) =>
    b.addEventListener("click", () => {
      box.hidden = true;
      go("clients");
      openClientCard(b.dataset.sclient);
    }),
  );
}

/* ---------- старт ---------- */
function wireStatic() {
  $("#login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    doLogin($("#login-email").value.trim(), $("#login-password").value);
  });
  // Демо-вход без зашитых паролей: пароль отдаёт GET /api/demo (генерируется
  // сервером при первом запуске). Кнопки строятся из ответа, а не из разметки.
  let demoPassword = null;
  const ROLE_SHORT = {
    admin: "администратор",
    manager: "менеджер",
    executor: "исполнитель",
  };
  api("GET", "/api/demo")
    .then((d) => {
      demoPassword = d.password;
      const box = document.getElementById("demo-box");
      if (!box) return;
      for (const a of d.accounts || []) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn btn-outline-secondary";
        b.textContent = `${String(a.name).split(" ")[0]}, ${ROLE_SHORT[a.role] || a.role}`;
        b.addEventListener("click", () => {
          $("#login-email").value = a.email;
          doLogin(a.email, demoPassword);
        });
        box.append(b);
      }
    })
    .catch(() => {
      const hint = document.getElementById("demo-hint");
      if (hint) {
        hint.textContent =
          "Демо-учётки недоступны: удалите data/store.json и перезапустите сервер.";
        hint.hidden = false;
      }
    });
  $$(".navbtn").forEach((b) =>
    b.addEventListener("click", () => go(b.dataset.route)),
  );
  $("#bell").addEventListener("click", () => go("notify"));
  $("#logout").addEventListener("click", async () => {
    if (!confirm("Выйти из аккаунта?")) return;
    try {
      await api("POST", "/api/logout");
    } catch {
      /* все равно выходим */
    }
    S.token = null;
    S.user = null;
    location.hash = "#/home";
    S.route = "home";
    showLogin();
  });
  $("#drawer-close").addEventListener("click", closeDrawer);
  $("#drawer-scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer();
  });

  let deb = null;
  $("#topsearch-input").addEventListener("input", (e) => {
    clearTimeout(deb);
    deb = setTimeout(() => topSearch(e.target.value), 350);
  });
  $("#topsearch-form").addEventListener("submit", (e) => {
    e.preventDefault();
    topSearch($("#topsearch-input").value);
  });
  document.addEventListener("click", (e) => {
    if (
      !e.target.closest("#topsearch-results") &&
      !e.target.closest("#topsearch-form")
    )
      $("#topsearch-results").hidden = true;
  });

  $("#order-create-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#nc-error");
    err.hidden = true;
    const title = $("#nc-title").value.trim();
    const clientId = $("#nc-client").value;
    const stageDue = $("#nc-stage-due").value;
    if (!title) {
      err.textContent = "Нужно название заказа";
      err.hidden = false;
      return;
    }
    if (!clientId) {
      err.textContent = "Клиент не найден: выберите клиента";
      err.hidden = false;
      return;
    }
    if (!stageDue) {
      err.textContent = "Нужен срок текущего этапа";
      err.hidden = false;
      return;
    }
    const btn = $("#nc-submit");
    btn.disabled = true;
    btn.textContent = "Создаем...";
    try {
      const payload = {
        title,
        clientId,
        stageDueDate: new Date(stageDue).toISOString(),
        executorId: $("#nc-exec").value || undefined,
        amount: Number($("#nc-amount").value) || 0,
        description: $("#nc-desc").value.trim(),
      };
      const data = await api("POST", "/api/orders", payload);
      bootstrap.Modal.getInstance($("#order-modal")).hide();
      toast("Заказ " + data.order.number + " создан");
      refreshBell();
      if (S.route === "orders") {
        S.ordersFilter = {
          stage: "",
          executorId: "",
          clientId: "",
          overdue: false,
          soon: false,
          q: "",
          sort: "stageDue",
        };
        renderOrders($("#view-orders"));
      } else renderHomeIfVisible();
      openOrder(data.order.id);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Создать заказ";
    }
  });

  $("#client-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#cf-error");
    err.hidden = true;
    const name = $("#cf-name").value.trim();
    if (!name) {
      err.textContent = "Нужно название клиента";
      err.hidden = false;
      return;
    }
    const id = $("#cf-id").value;
    const payload = {
      name,
      contactName: $("#cf-contact").value.trim(),
      status: $("#cf-status").value,
      email: $("#cf-email").value.trim(),
      phone: $("#cf-phone").value.trim(),
      note: $("#cf-note").value.trim(),
    };
    const btn = $("#cf-submit");
    btn.disabled = true;
    btn.textContent = "Сохраняем...";
    try {
      if (id)
        await api("PATCH", "/api/clients/" + encodeURIComponent(id), payload);
      else await api("POST", "/api/clients", payload);
      bootstrap.Modal.getInstance($("#client-modal")).hide();
      toast("Клиент сохранен");
      renderClients($("#view-clients"));
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Сохранить";
    }
  });

  window.addEventListener("hashchange", () => {
    const r = (location.hash || "").replace("#/", "") || "home";
    if (["home", "orders", "clients", "notify"].includes(r) && S.user) {
      S.route = r;
      markNav();
      render();
    }
  });
}

wireStatic();
(function init() {
  const r = (location.hash || "").replace("#/", "") || "home";
  if (["home", "orders", "clients", "notify"].includes(r)) S.route = r;
  showLogin();
})();

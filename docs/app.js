(function () {
  const app = document.getElementById("app");
  const page = document.body.dataset.page || "home";
  const groupId = document.body.dataset.groupId || "";
  const baseUrl = new URL(".", document.currentScript.src);

  const typeLabels = {
    live: "ライブ",
    ticket: "チケ発",
    free: "無料",
    deadline: "締切",
    release: "リリース",
    media: "メディア"
  };

  const typeOrder = ["all", "live", "free", "ticket", "deadline", "release", "media"];

  const state = {
    groups: [],
    group: null,
    events: [],
    month: null,
    selectedDate: "",
    filter: "all"
  };

  const fmtMonth = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long" });
  const fmtWeekday = new Intl.DateTimeFormat("ja-JP", { weekday: "short" });

  init().catch((error) => {
    console.error(error);
    app.innerHTML = `<div class="error-state">読み込みに失敗しました。${escapeHtml(error.message || String(error))}</div>`;
  });

  async function init() {
    app.innerHTML = `<div class="loading">Loading...</div>`;
    const config = await fetchJson("config/groups.json");
    state.groups = config.groups || [];

    if (page === "group") {
      state.group = state.groups.find((group) => group.id === groupId);
      if (!state.group) {
        throw new Error(`グループが見つかりません: ${groupId}`);
      }
      applyGroupTheme(state.group);
      state.events = await fetchJson(`data/${groupId}/events.json`);
      state.events.sort(compareEvents);
      state.month = pickInitialMonth(state.events);
      renderGroupPage();
      return;
    }

    renderHomePage();
  }

  async function fetchJson(path) {
    const response = await fetch(new URL(path, baseUrl), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`${path} (${response.status})`);
    }
    return response.json();
  }

  function applyGroupTheme(group) {
    document.documentElement.style.setProperty("--primary", group.color || "#ff4f9a");
    document.documentElement.style.setProperty("--accent", group.accent || "#25c2a0");
  }

  function renderHomePage() {
    app.innerHTML = `
      ${renderTopbar({
        title: "Oshi Calendar",
        subtitle: "グループ別のライブ・チケ発カレンダー",
        activeGroupId: ""
      })}
      <main class="home-grid">
        ${state.groups.map((group) => `
          <a class="group-card" href="./${group.id}/" style="--primary:${escapeAttr(group.color || "#ff4f9a")}">
            <span></span>
            <strong>${escapeHtml(group.name)}</strong>
            <p>@${escapeHtml(group.x_account)}</p>
            <p>${escapeHtml(group.description || "")}</p>
          </a>
        `).join("")}
      </main>
    `;
  }

  function renderGroupPage() {
    app.innerHTML = `
      ${renderTopbar({
        title: `${state.group.name} Calendar`,
        subtitle: `@${state.group.x_account}`,
        activeGroupId: state.group.id
      })}
      <main class="dashboard">
        <section class="panel calendar-panel" aria-label="カレンダー">
          <div class="calendar-toolbar">
            <h2 class="month-title">${escapeHtml(fmtMonth.format(state.month))}</h2>
            <div class="toolbar-buttons">
              <button class="icon-button" type="button" data-action="prev-month" aria-label="前の月">‹</button>
              <button class="primary-button" type="button" data-action="today">今日</button>
              <button class="icon-button" type="button" data-action="next-month" aria-label="次の月">›</button>
            </div>
          </div>
          ${renderCalendar()}
        </section>
        <aside class="panel side-panel">
          <div class="filters" aria-label="種別フィルター">
            ${renderFilters()}
          </div>
          ${renderEventSections()}
        </aside>
      </main>
      ${renderModalShell()}
    `;
    bindGroupEvents();
  }

  function renderTopbar({ title, subtitle, activeGroupId }) {
    return `
      <header class="topbar">
        <div class="brand">
          <a class="brand-mark" href="${page === "home" ? "./" : "../"}" aria-label="トップへ">OC</a>
          <div>
            <h1>${escapeHtml(title)}</h1>
            <p>${escapeHtml(subtitle)}</p>
          </div>
        </div>
        <nav class="nav-links" aria-label="グループ">
          <a class="pill-link ${activeGroupId ? "" : "active"}" href="${page === "home" ? "./" : "../"}">ALL</a>
          ${state.groups.map((group) => `
            <a class="pill-link ${group.id === activeGroupId ? "active" : ""}" href="${page === "home" ? `./${group.id}/` : `../${group.id}/`}">
              ${escapeHtml(group.name)}
            </a>
          `).join("")}
        </nav>
      </header>
    `;
  }

  function renderCalendar() {
    const weekdays = ["月", "火", "水", "木", "金", "土", "日"];
    const cells = getCalendarCells(state.month);
    return `
      <div class="calendar-grid">
        ${weekdays.map((day, i) => {
          let cls = "weekday";
          if (i === 5) cls += " saturday";
          if (i === 6) cls += " sunday";
          return `<div class="${cls}">${day}</div>`;
        }).join("")}
        ${cells.map(renderDayCell).join("")}
      </div>
    `;
  }

  function renderDayCell(date) {
    const dateKey = toDateKey(date);
    const dayEvents = state.events.filter((event) => event.date === dateKey);
    const inMonth = date.getMonth() === state.month.getMonth();
    const isToday = dateKey === toDateKey(new Date());
    const isSelected = dateKey === state.selectedDate;
    const dayOfWeek = date.getDay(); // 0 = 日曜, 6 = 土曜
    const visibleChips = dayEvents.slice(0, 3);
    const className = [
      "day-cell",
      inMonth ? "" : "is-outside",
      isToday ? "is-today" : "",
      isSelected ? "is-selected" : "",
      dayOfWeek === 6 ? "is-saturday" : "",
      dayOfWeek === 0 ? "is-sunday" : ""
    ].filter(Boolean).join(" ");

    return `
      <div class="${className}">
        <button class="day-button" type="button" data-date="${dateKey}" aria-label="${dateKey}">
          <span class="day-number">${date.getDate()}</span>
          <span class="day-events">
            ${visibleChips.map(renderEventChip).join("")}
            ${dayEvents.length > visibleChips.length ? `<span class="event-chip more">+${dayEvents.length - visibleChips.length}</span>` : ""}
          </span>
        </button>
      </div>
    `;
  }

  function renderEventChip(event) {
    return `
      <span class="event-chip ${escapeAttr(event.type)}">
        <time>${escapeHtml(chipTime(event))}</time>
        <span>${escapeHtml(chipTitle(event))}</span>
      </span>
    `;
  }

  function chipTime(event) {
    if (event.type === "ticket") return `チケ発 ${event.time_start || ""}`.trim();
    if (event.type === "deadline") return `締切 ${event.time_start || ""}`.trim();
    const time = event.time_open || event.time_start;
    if (time) return time;
    return typeLabels[event.type] || "予定";
  }

  function chipTitle(event) {
    return event.type === "ticket" ? event.title.replace(/\s*チケ発$/, "") : event.title;
  }

  function renderFilters() {
    const available = new Set(state.events.map((event) => event.type));
    return typeOrder
      .filter((type) => type === "all" || available.has(type))
      .map((type) => `
        <button class="filter-button ${state.filter === type ? "active" : ""}" type="button" data-filter="${type}">
          ${escapeHtml(type === "all" ? "すべて" : typeLabels[type])}
        </button>
      `).join("");
  }

  function renderEventSections() {
    const filtered = filteredEvents();
    const selectedLabel = state.selectedDate ? formatDateLabel(state.selectedDate) : "今後の予定";
    const liveLike = filtered.filter((event) => !["ticket", "deadline"].includes(event.type));
    const muted = filtered.filter((event) => ["ticket", "deadline"].includes(event.type));

    return `
      <section>
        <h2 class="section-title">
          <span>${escapeHtml(selectedLabel)}</span>
          <small>${filtered.length}件</small>
        </h2>
      </section>
      <section>
        <h3 class="section-title"><span>ライブ・イベント</span><small>${liveLike.length}件</small></h3>
        <div class="event-list">
          ${liveLike.length ? liveLike.map(renderEventCard).join("") : `<div class="empty-state">該当する予定はありません。</div>`}
        </div>
      </section>
      <section>
        <h3 class="section-title"><span>チケット・締切</span><small>${muted.length}件</small></h3>
        <div class="event-list">
          ${muted.length ? muted.map(renderEventCard).join("") : `<div class="empty-state">該当する予定はありません。</div>`}
        </div>
      </section>
    `;
  }

  function renderEventCard(event) {
    return `
      <button class="event-card ${escapeAttr(event.type)}" type="button" data-event-id="${escapeAttr(event.id)}">
        <span class="event-card-header">
          <h3>${escapeHtml(event.title)}</h3>
          <span class="type-badge">${escapeHtml(typeLabels[event.type] || event.type)}</span>
        </span>
        <span class="event-card-meta">
          <span>${escapeHtml(formatDateLabel(event.date))}</span>
          ${event.time_open ? `<span>OPEN ${escapeHtml(event.time_open)}</span>` : ""}
          ${event.time_start ? `<span>START ${escapeHtml(event.time_start)}</span>` : ""}
          ${event.time_end ? `<span>END ${escapeHtml(event.time_end)}</span>` : ""}
          ${event.venue ? `<span>${escapeHtml(event.venue)}</span>` : ""}
        </span>
      </button>
    `;
  }

  function renderModalShell() {
    return `
      <div class="modal-backdrop" data-modal-backdrop>
        <article class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div class="modal-header">
            <div id="modal-heading"></div>
            <button class="icon-button" type="button" data-action="close-modal" aria-label="閉じる">×</button>
          </div>
          <div class="modal-body" id="modal-body"></div>
        </article>
      </div>
    `;
  }

  function bindGroupEvents() {
    app.querySelector("[data-action='prev-month']").addEventListener("click", () => {
      state.month = addMonths(state.month, -1);
      renderGroupPage();
    });

    app.querySelector("[data-action='next-month']").addEventListener("click", () => {
      state.month = addMonths(state.month, 1);
      renderGroupPage();
    });

    app.querySelector("[data-action='today']").addEventListener("click", () => {
      state.month = startOfMonth(new Date());
      state.selectedDate = toDateKey(new Date());
      renderGroupPage();
    });

    app.querySelectorAll("[data-date]").forEach((button) => {
      button.addEventListener("click", () => {
        const date = button.dataset.date;
        state.selectedDate = state.selectedDate === date ? "" : date;
        state.month = startOfMonth(parseDateKey(date));
        renderGroupPage();
      });
    });

    app.querySelectorAll("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.filter = button.dataset.filter || "all";
        renderGroupPage();
      });
    });

    app.querySelectorAll("[data-event-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const event = state.events.find((item) => item.id === button.dataset.eventId);
        if (event) openModal(event);
      });
    });

    app.querySelector("[data-action='close-modal']").addEventListener("click", closeModal);
    app.querySelector("[data-modal-backdrop]").addEventListener("click", (event) => {
      if (event.target.matches("[data-modal-backdrop]")) closeModal();
    });

    document.addEventListener("keydown", handleEscape, { once: true });
  }

  function handleEscape(event) {
    if (event.key === "Escape") closeModal();
    document.addEventListener("keydown", handleEscape, { once: true });
  }

  function openModal(event) {
    const heading = app.querySelector("#modal-heading");
    const body = app.querySelector("#modal-body");
    const backdrop = app.querySelector("[data-modal-backdrop]");
    heading.innerHTML = `
      <span class="type-badge">${escapeHtml(typeLabels[event.type] || event.type)}</span>
      <h2 id="modal-title">${escapeHtml(event.title)}</h2>
    `;
    body.innerHTML = `
      <div class="detail-grid">
        ${detail("日付", formatDateLabel(event.date))}
        ${event.time_open ? detail("OPEN", event.time_open) : ""}
        ${event.time_start ? detail(event.type === "ticket" ? "発売開始" : event.type === "deadline" ? "締切" : "START", event.time_start) : ""}
        ${event.time_end ? detail("END", event.time_end) : ""}
        ${event.venue ? detail("会場", event.venue) : ""}
        ${event.benefit_time ? detail("特典会", event.benefit_time) : ""}
        ${event.price ? detail("料金", event.price) : ""}
      </div>
      ${event.image_url ? `<div class="modal-image"><img src="${escapeAttr(event.image_url)}" alt="イベント画像" loading="lazy" /></div>` : ""}
      ${event.description ? `<p>${escapeHtml(event.description)}</p>` : ""}
      <div class="modal-actions">
        ${event.ticket_url ? `<a class="primary-button" href="${escapeAttr(event.ticket_url)}" target="_blank" rel="noreferrer">チケット/詳細</a>` : ""}
        ${event.post_url ? `<a class="pill-link" href="${escapeAttr(event.post_url)}" target="_blank" rel="noreferrer">元ポスト</a>` : ""}
      </div>
    `;
    backdrop.classList.add("open");
  }

  function closeModal() {
    const backdrop = app.querySelector("[data-modal-backdrop]");
    if (backdrop) backdrop.classList.remove("open");
  }

  function detail(label, value) {
    return `
      <div class="detail-item">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(value)}</span>
      </div>
    `;
  }

  function filteredEvents() {
    const todayKey = toDateKey(new Date());
    return state.events.filter((event) => {
      if (state.selectedDate && event.date !== state.selectedDate) return false;
      if (!state.selectedDate && event.date < todayKey) return false;
      if (state.filter !== "all" && event.type !== state.filter) return false;
      return true;
    });
  }

  function pickInitialMonth(events) {
    const todayKey = toDateKey(new Date());
    const upcoming = events.find((event) => event.date >= todayKey) || events[0];
    return startOfMonth(upcoming ? parseDateKey(upcoming.date) : new Date());
  }

  function getCalendarCells(monthDate) {
    const first = startOfMonth(monthDate);
    const start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }

  function compareEvents(a, b) {
    return `${a.date} ${a.time_start || "99:99"}`.localeCompare(`${b.date} ${b.time_start || "99:99"}`);
  }

  function addMonths(date, amount) {
    return new Date(date.getFullYear(), date.getMonth() + amount, 1);
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function parseDateKey(dateKey) {
    const [year, month, day] = dateKey.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function toDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatDateLabel(dateKey) {
    const date = parseDateKey(dateKey);
    return `${date.getMonth() + 1}/${date.getDate()}(${fmtWeekday.format(date)})`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();

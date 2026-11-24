/*
 * 批量置入 PNG 到 PSD  ·  CEP 面板前端
 * 全部 Photoshop 操作交给 host/jsx/host.jsx，这里只管界面和调度。
 */

const state = {
  encoded: "",
  items: [],
  running: false
};

let el = {};

/* 后端传过来的中文都是 URL 编码的，这里统一还原 */
function safeDecode(s) {
  if (s === null || s === undefined) return "";
  try {
    return decodeURIComponent(String(s));
  } catch (e) {
    return String(s);
  }
}

/* ---------------- CEP 桥 ---------------- */

function hasCEP() {
  return typeof window.__adobe_cep__ !== "undefined";
}

function evalScript(script) {
  return new Promise((resolve) => {
    if (!hasCEP()) {
      resolve("");
      return;
    }
    try {
      window.__adobe_cep__.evalScript(script, (res) => {
        resolve(res === undefined || res === null ? "" : String(res));
      });
    } catch (e) {
      resolve("");
    }
  });
}

function esc(s) {
  return "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

/* ---------------- 主题 ---------------- */

function applyTheme() {
  if (!hasCEP()) return;
  try {
    const env = JSON.parse(window.__adobe_cep__.getHostEnvironment());
    const c = env.appSkinInfo.panelBackgroundColor.color;
    const dark = 0.299 * c.red + 0.587 * c.green + 0.114 * c.blue < 128;
    const root = document.documentElement.style;
    root.setProperty("--bg", `rgb(${Math.round(c.red)},${Math.round(c.green)},${Math.round(c.blue)})`);
    root.setProperty("--fg", dark ? "#d6d6d6" : "#1a1a1a");
    root.setProperty("--dim", dark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.55)");
    root.setProperty("--line", dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)");
    root.setProperty("--fill", dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)");
    root.setProperty("--fill-hover", dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)");
  } catch (e) {
    /* 拿不到就用默认深色 */
  }
}

/* ---------------- DOM ---------------- */

function cacheDom() {
  el = {
    dropZone: document.getElementById("dropZone"),
    folderPath: document.getElementById("folderPath"),
    dirStatus: document.getElementById("dirStatus"),
    list: document.getElementById("list"),
    count: document.getElementById("count"),
    btnAll: document.getElementById("btnAll"),
    btnNone: document.getElementById("btnNone"),
    btnRun: document.getElementById("btnRun"),
    optAlpha: document.getElementById("optAlpha"),
    optClean: document.getElementById("optClean"),
    optSave: document.getElementById("optSave"),
    barFill: document.getElementById("barFill"),
    status: document.getElementById("status"),
    log: document.getElementById("log")
  };
}

function log(msg) {
  if (!el.log) return;
  const line = document.createElement("div");
  line.textContent = msg;
  el.log.appendChild(line);
  el.log.scrollTop = el.log.scrollHeight;
  while (el.log.childNodes.length > 300) {
    el.log.removeChild(el.log.firstChild);
  }
}

function setStatus(msg) {
  if (el.status) el.status.textContent = msg;
}

function setProgress(pct, label) {
  if (el.barFill) el.barFill.style.width = Math.max(0, Math.min(100, pct)) + "%";
  if (label) setStatus(label);
}

/* ---------------- 扫描 ---------------- */

async function scan() {
  if (!state.encoded) return;

  el.list.innerHTML = '<div class="empty">正在扫描…</div>';

  const raw = await evalScript(`PPS_scan(${esc(state.encoded)})`);
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    log("扫描返回异常：" + raw);
    el.list.innerHTML = '<div class="empty">扫描失败，看下方日志</div>';
    setStatus("扫描失败");
    return;
  }

  if (!data.ok) {
    const msg = safeDecode(data.error);
    log("扫描失败：" + msg);
    el.list.innerHTML = '<div class="empty">扫描失败</div>';
    setStatus("扫描失败：" + msg);
    return;
  }

  state.items = data.items.map((it) => ({
    idx: it.idx,
    name: safeDecode(it.name),
    hasMat: it.hasMat,
    hasObj: it.hasObj,
    checked: it.hasMat || it.hasObj,
    result: null,
    error: null
  }));

  renderDirs(data);
  renderList();

  const usable = state.items.filter((i) => i.hasMat || i.hasObj).length;
  setStatus(`扫描完成：${data.psdCount} 个 PSD，可配对 ${usable} 个`);
  log(`扫描完成：PSD ${data.psdCount} / PNG ${data.matCount}+${data.objCount}`);
}

function renderDirs(data) {
  const rows = [
    { label: "mat_2", count: data.matCount, has: data.hasMatDir },
    { label: "obj_1", count: data.objCount, has: data.hasObjDir },
    { label: "rgba", count: data.psdCount, has: data.hasPsdDir }
  ];

  el.dirStatus.innerHTML = "";
  rows.forEach((r) => {
    const row = document.createElement("div");
    row.className = "dir-row";

    const name = document.createElement("div");
    name.className = "dir-name";
    name.textContent = r.label;

    const count = document.createElement("div");
    count.className = "dir-count";
    count.textContent = r.has ? `${r.count} 个` : "不存在";

    const badge = document.createElement("div");
    badge.className = "dir-badge " + (r.has && r.count > 0 ? "ok" : "err");
    badge.textContent = r.has && r.count > 0 ? "✓" : "✗";

    row.appendChild(name);
    row.appendChild(count);
    row.appendChild(badge);
    el.dirStatus.appendChild(row);
  });
}

function renderList() {
  el.list.innerHTML = "";

  if (!state.items.length) {
    el.list.innerHTML = '<div class="empty">没有找到 PSD 文件</div>';
    el.count.textContent = "0 / 0";
    return;
  }

  const frag = document.createDocumentFragment();

  state.items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "item" + (item.result ? " done" : "");

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = item.checked;
    box.disabled = !(item.hasMat || item.hasObj) || state.running;
    box.addEventListener("change", () => {
      item.checked = box.checked;
      updateCount();
    });

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = item.name;
    name.title = item.name;

    const tag = document.createElement("div");
    tag.className = "tag";
    if (item.result === "ok") {
      tag.textContent = "完成";
      tag.classList.add("ok");
    } else if (item.result === "fail") {
      tag.textContent = "失败";
      tag.classList.add("err");
      tag.title = item.error || "";
    } else if (item.hasMat && item.hasObj) {
      tag.textContent = "mat + obj";
    } else if (item.hasMat) {
      tag.textContent = "仅 mat";
      tag.classList.add("warn");
    } else if (item.hasObj) {
      tag.textContent = "仅 obj";
      tag.classList.add("warn");
    } else {
      tag.textContent = "无配对";
      tag.classList.add("err");
    }

    row.appendChild(box);
    row.appendChild(name);
    row.appendChild(tag);

    row.addEventListener("click", (ev) => {
      if (ev.target === box || state.running || box.disabled) return;
      box.checked = !box.checked;
      item.checked = box.checked;
      updateCount();
    });

    frag.appendChild(row);
  });

  el.list.appendChild(frag);
  updateCount();
}

function updateCount() {
  const usable = state.items.filter((i) => i.hasMat || i.hasObj);
  const checked = usable.filter((i) => i.checked).length;
  el.count.textContent = `${checked} / ${usable.length}`;
}

/* ---------------- 选目录 ---------------- */

async function selectFolder() {
  if (state.running) return;
  const encoded = await evalScript("PPS_sel()");
  if (!encoded) return;

  state.encoded = encoded;
  const shown = safeDecode(encoded);
  el.folderPath.textContent = shown;
  log("已选择：" + shown);
  await scan();
}

/* ---------------- 执行 ---------------- */

async function run() {
  if (state.running) return;

  const targets = state.items.filter((i) => i.checked && (i.hasMat || i.hasObj));
  if (!targets.length) {
    setStatus("没有勾选任何可处理项");
    return;
  }

  state.running = true;
  el.btnRun.disabled = true;
  el.btnRun.textContent = "执行中…";
  el.btnAll.disabled = true;
  el.btnNone.disabled = true;
  renderList();

  let okCount = 0;
  let failCount = 0;

  const applyAlpha = el.optAlpha.checked ? "1" : "0";
  const saveFile = el.optSave.checked ? "1" : "0";
  const cleanOthers = el.optClean.checked ? "1" : "0";

  for (let i = 0; i < targets.length; i++) {
    const item = targets[i];
    setProgress(Math.round((i / targets.length) * 100), `(${i + 1}/${targets.length}) ${item.name}`);

    const script = `PPS_run(${item.idx},${applyAlpha},${saveFile},${cleanOthers})`;

    const raw = await evalScript(script);

    let r = null;
    try {
      r = JSON.parse(raw);
    } catch (e) {
      r = { ok: false, error: "返回异常：" + raw };
    }

    if (r.ok) {
      item.result = "ok";
      okCount++;
      let extra = "";
      if (r.alpha) extra += "  Alpha 已应用";
      if (r.cleaned) extra += `  清理${r.cleaned}个多余图层`;
      log(`✓ ${item.name}${extra}`);
      if (Array.isArray(r.layers) && r.layers.length) {
        log(`   最终图层：${r.layers.map(safeDecode).join(" / ")}`);
      }
    } else {
      item.result = "fail";
      item.error = safeDecode(r.error);
      failCount++;
      log(`✗ ${item.name}：${item.error}`);
    }

    setProgress(Math.round(((i + 1) / targets.length) * 100));
    renderList();
  }

  state.running = false;
  el.btnRun.disabled = false;
  el.btnRun.textContent = "开始执行";
  el.btnAll.disabled = false;
  el.btnNone.disabled = false;
  renderList();

  const summary = `成功 ${okCount}，失败 ${failCount}`;
  setStatus(summary);
  log("—— " + summary + " ——");
}

/* ---------------- 初始化 ---------------- */

function bindEvents() {
  el.dropZone.addEventListener("click", selectFolder);
  el.btnRun.addEventListener("click", run);

  el.btnAll.addEventListener("click", () => {
    if (state.running) return;
    state.items.forEach((i) => {
      if (i.hasMat || i.hasObj) i.checked = true;
    });
    renderList();
  });

  el.btnNone.addEventListener("click", () => {
    if (state.running) return;
    state.items.forEach((i) => {
      i.checked = false;
    });
    renderList();
  });
}

async function init() {
  cacheDom();
  applyTheme();
  bindEvents();

  // 不保留任何历史状态，每次打开都是干净界面
  try {
    localStorage.removeItem("placePng.lastFolder");
  } catch (e) {
    /* ignore */
  }

  if (!hasCEP()) {
    log("当前不在 Photoshop 中运行，面板不可用");
    setStatus("请在 Photoshop 中打开此面板");
    return;
  }

  log("面板已加载");

  const ok = await evalScript("typeof PPS_scan");
  if (ok !== "function") {
    log("后端脚本未加载，请重启 Photoshop");
    setStatus("后端脚本未加载");
    return;
  }

  setStatus("选择父文件夹开始");
}

window.addEventListener("load", init);

/* ==========================================================================
 * app.js — 食事管理・健康アドバイスアプリ本体
 * 依存ライブラリなし。データは localStorage に保存（端末内で完結）。
 * 写真解析は任意で Claude Vision API を利用（設定でAPIキーを入力した場合）。
 * ======================================================================== */
(function () {
  "use strict";

  const { FOODS, EXERCISE_MET, BEHAVIOR, GOALS } = window.MEAL_DATA;
  const MEAL_SLOTS = [
    { key: "breakfast", label: "朝食", icon: "🌅" },
    { key: "lunch", label: "昼食", icon: "🌞" },
    { key: "dinner", label: "夕食", icon: "🌙" },
    { key: "snack", label: "間食", icon: "🍪" },
  ];
  const STORE_KEY = "mealApp.v1";
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const fmt = (n, d = 0) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString("ja-JP");
  const todayStr = () => new Date().toISOString().slice(0, 10);

  // ---- 状態管理 -----------------------------------------------------------
  const State = {
    data: null,
    load() {
      try {
        this.data = JSON.parse(localStorage.getItem(STORE_KEY)) || null;
      } catch (_) { this.data = null; }
      if (!this.data) this.data = { profile: null, logs: {}, settings: {} };
      if (!this.data.logs) this.data.logs = {};
      if (!this.data.settings) this.data.settings = {};
      // キーはサービスごとに保持。旧形式(apiKey単一)があれば移行する。
      const s = this.data.settings;
      if (!s.keys) s.keys = { gemini: "", anthropic: "" };
      if (s.apiKey) {
        const prov = s.provider || "gemini";
        if (!s.keys[prov]) s.keys[prov] = s.apiKey;
        delete s.apiKey;
      }
      if (!s.provider) s.provider = "gemini";
    },
    save() { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); },
    log(date) {
      if (!this.data.logs[date]) {
        this.data.logs[date] = {
          meals: { breakfast: [], lunch: [], dinner: [], snack: [] },
          activity: { steps: 0, behavior: BEHAVIOR[0].name, exercises: [] },
          weight: null,
        };
      }
      const l = this.data.logs[date];
      if (!l.meals) l.meals = { breakfast: [], lunch: [], dinner: [], snack: [] };
      if (!l.activity) l.activity = { steps: 0, behavior: BEHAVIOR[0].name, exercises: [] };
      if (!("weight" in l)) l.weight = null;
      return l;
    },
  };

  // ---- 身体指標の計算 ----------------------------------------------------
  const Metrics = {
    bmi(p) { const m = p.height / 100; return p.weight / (m * m); },
    bmiCategory(bmi) {
      if (bmi < 18.5) return { label: "低体重(やせ)", tone: "warn" };
      if (bmi < 25) return { label: "普通体重", tone: "good" };
      if (bmi < 30) return { label: "肥満(1度)", tone: "warn" };
      return { label: "肥満(2度以上)", tone: "bad" };
    },
    // Mifflin-St Jeor 式による基礎代謝量(kcal/日)
    bmr(p) {
      const base = 10 * p.weight + 6.25 * p.height - 5 * p.age;
      return p.sex === "male" ? base + 5 : base - 161;
    },
    // その日の総消費カロリー = 基礎代謝 + 生活活動(NEAT) + 歩数 + 運動
    burned(p, activity) {
      const bmr = this.bmr(p);
      const beh = BEHAVIOR.find((b) => b.name === activity.behavior) || BEHAVIOR[0];
      const neat = bmr * (beh.factor - 1); // 生活活動による上乗せ
      const stepKcal = (activity.steps || 0) * (p.weight / 70) * 0.04; // 1歩あたり概算
      const exKcal = (activity.exercises || []).reduce(
        (s, e) => s + e.met * p.weight * (e.minutes / 60) * 1.05, 0);
      return { bmr, neat, stepKcal, exKcal, total: bmr + neat + stepKcal + exKcal };
    },
    // 1日の目標摂取カロリー（消費 × 目標補正）
    targetIntake(p, burnedTotal) {
      const goal = GOALS.find((g) => g.key === p.goal) || GOALS[1];
      return burnedTotal * (1 + goal.adjust);
    },
    // 栄養素の1日推奨量
    nutrientTargets(p, targetKcal) {
      // たんぱく質: 目標により体重あたりを変える
      const gPerKg = p.goal === "muscle" ? 1.6 : p.goal === "diet" ? 1.4 : 1.1;
      const protein = p.weight * gPerKg;
      const fat = (targetKcal * 0.25) / 9;           // 脂質は総kcalの25%目安
      const carb = (targetKcal - protein * 4 - fat * 9) / 4;
      const fiber = p.sex === "male" ? 21 : 18;      // 食物繊維(g/日)
      const saltMax = p.sex === "male" ? 7.5 : 6.5;  // 食塩相当量 上限(g/日)
      return { protein, fat, carb, fiber, saltMax };
    },
  };

  // ---- 集計 ---------------------------------------------------------------
  function sumItems(items) {
    return (items || []).reduce((a, it) => ({
      kcal: a.kcal + it.kcal * it.qty,
      p: a.p + it.p * it.qty,
      f: a.f + it.f * it.qty,
      c: a.c + it.c * it.qty,
      fiber: a.fiber + it.fiber * it.qty,
      salt: a.salt + it.salt * it.qty,
    }), { kcal: 0, p: 0, f: 0, c: 0, fiber: 0, salt: 0 });
  }
  function dayTotals(log) {
    const slots = {};
    let all = { kcal: 0, p: 0, f: 0, c: 0, fiber: 0, salt: 0 };
    MEAL_SLOTS.forEach((s) => {
      const t = sumItems(log.meals[s.key]);
      slots[s.key] = t;
      Object.keys(all).forEach((k) => (all[k] += t[k]));
    });
    return { slots, all };
  }

  // ---- ナビゲーション -----------------------------------------------------
  const Nav = {
    tabs: [
      { key: "dashboard", label: "ダッシュボード", icon: "📊" },
      { key: "record", label: "記録する", icon: "✍️" },
      { key: "trend", label: "推移グラフ", icon: "📈" },
      { key: "profile", label: "プロフィール", icon: "👤" },
      { key: "settings", label: "設定", icon: "⚙️" },
    ],
    current: "dashboard",
    go(key) { this.current = key; render(); window.scrollTo(0, 0); },
  };

  // ==========================================================================
  //  レンダリング
  // ==========================================================================
  function render() {
    const app = $("#app");
    if (!State.data.profile) { Nav.current = "profile"; }
    app.innerHTML = `
      <header class="topbar">
        <div class="brand">🍱 <span>ミール・ヘルスケア</span></div>
        <div class="today">${new Date().toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" })}</div>
      </header>
      <nav class="tabs">
        ${Nav.tabs.map((t) => `<button class="tab ${Nav.current === t.key ? "active" : ""}" data-tab="${t.key}">
           <span class="ti">${t.icon}</span><span class="tl">${t.label}</span></button>`).join("")}
      </nav>
      <main id="view"></main>`;
    $$(".tab").forEach((b) => (b.onclick = () => Nav.go(b.dataset.tab)));
    const view = $("#view");
    if (!State.data.profile && Nav.current !== "profile") Nav.current = "profile";
    ({
      dashboard: renderDashboard,
      record: renderRecord,
      trend: renderTrend,
      profile: renderProfile,
      settings: renderSettings,
    })[Nav.current](view);
  }

  // ---- プロフィール -------------------------------------------------------
  function renderProfile(view) {
    const p = State.data.profile || { sex: "male", goal: "health" };
    view.innerHTML = `
      <section class="card">
        <h2>プロフィール設定</h2>
        <p class="muted">身長・体重・性別・年齢と目標を入力すると、BMI・基礎代謝を自動計算し、毎日の分析に使います。</p>
        <div class="form-grid">
          <label>身長 (cm)<input type="number" id="pf-height" value="${p.height ?? ""}" min="100" max="230" step="0.1"></label>
          <label>体重 (kg)<input type="number" id="pf-weight" value="${p.weight ?? ""}" min="30" max="200" step="0.1"></label>
          <label>年齢<input type="number" id="pf-age" value="${p.age ?? ""}" min="10" max="100"></label>
          <label>性別
            <select id="pf-sex">
              <option value="male" ${p.sex === "male" ? "selected" : ""}>男性</option>
              <option value="female" ${p.sex === "female" ? "selected" : ""}>女性</option>
            </select>
          </label>
          <label>目標体重 (kg・任意)<input type="number" id="pf-target" value="${p.targetWeight ?? ""}" min="30" max="200" step="0.1"></label>
          <label>目的・目標
            <select id="pf-goal">
              ${GOALS.map((g) => `<option value="${g.key}" ${p.goal === g.key ? "selected" : ""}>${g.name}（${g.desc}）</option>`).join("")}
            </select>
          </label>
        </div>
        <button class="btn primary" id="pf-save">保存して計算する</button>
        <div id="pf-result"></div>
      </section>`;
    $("#pf-save").onclick = () => {
      const np = {
        height: parseFloat($("#pf-height").value),
        weight: parseFloat($("#pf-weight").value),
        age: parseInt($("#pf-age").value, 10),
        sex: $("#pf-sex").value,
        goal: $("#pf-goal").value,
        targetWeight: parseFloat($("#pf-target").value) || null,
      };
      if (!(np.height > 0 && np.weight > 0 && np.age > 0)) {
        alert("身長・体重・年齢を正しく入力してください。");
        return;
      }
      State.data.profile = np;
      // 当日の体重が未記録なら profile の体重で初期化
      const l = State.log(todayStr());
      if (l.weight == null) l.weight = np.weight;
      State.save();
      showProfileResult(np);
    };
    if (State.data.profile) showProfileResult(State.data.profile);
  }
  function showProfileResult(p) {
    const bmi = Metrics.bmi(p);
    const cat = Metrics.bmiCategory(bmi);
    const bmr = Metrics.bmr(p);
    const b = Metrics.burned(p, { steps: 6000, behavior: BEHAVIOR[1].name, exercises: [] });
    const goal = GOALS.find((g) => g.key === p.goal) || GOALS[1];
    const target = Metrics.targetIntake(p, b.total);
    $("#pf-result").innerHTML = `
      <div class="result-grid">
        <div class="stat"><div class="stat-l">BMI</div><div class="stat-v">${fmt(bmi, 1)}</div><div class="badge ${cat.tone}">${cat.label}</div></div>
        <div class="stat"><div class="stat-l">基礎代謝</div><div class="stat-v">${fmt(bmr)}<small>kcal</small></div><div class="muted">何もしなくても消費</div></div>
        <div class="stat"><div class="stat-l">目安の消費<small>(出社+6千歩)</small></div><div class="stat-v">${fmt(b.total)}<small>kcal</small></div></div>
        <div class="stat"><div class="stat-l">目標摂取</div><div class="stat-v">${fmt(target)}<small>kcal</small></div><div class="muted">${goal.name}</div></div>
      </div>
      <p class="muted">※ 消費・目標は当日の歩数や行動で変わります。「記録する」で毎日の実測値を入れてください。</p>`;
  }

  // ---- 記録する（当日の食事・活動） --------------------------------------
  let recordDate = todayStr();
  let dashDate = todayStr();
  function renderRecord(view) {
    const p = State.data.profile;
    const log = State.log(recordDate);
    view.innerHTML = `
      <section class="card">
        <div class="row between">
          <h2>記録する</h2>
          <input type="date" id="rec-date" value="${recordDate}" max="${todayStr()}">
        </div>

        <div class="meals">
          ${MEAL_SLOTS.map((s) => renderMealSlot(s, log)).join("")}
        </div>

        <h3 class="mt">消費カロリー（活動）</h3>
        <div class="form-grid">
          <label>歩数<input type="number" id="ac-steps" value="${log.activity.steps || ""}" min="0" step="100" placeholder="例: 8000"></label>
          <label>今日の行動パターン
            <select id="ac-behavior">
              ${BEHAVIOR.map((b) => `<option value="${b.name}" ${log.activity.behavior === b.name ? "selected" : ""}>${b.name}</option>`).join("")}
            </select>
          </label>
          <label>体重 (kg)<input type="number" id="ac-weight" value="${log.weight ?? ""}" min="30" max="200" step="0.1" placeholder="任意"></label>
        </div>

        <div class="ex-add">
          <div class="row wrap">
            <select id="ex-name">${EXERCISE_MET.map((e) => `<option value="${e.name}">${e.name}（${e.level}）</option>`).join("")}</select>
            <input type="number" id="ex-min" placeholder="分" min="1" step="5" style="max-width:90px">
            <button class="btn" id="ex-add">運動を追加</button>
          </div>
          <ul class="chips">
            ${(log.activity.exercises || []).map((e, i) => `<li class="chip">${e.name} ${e.minutes}分 <button data-ex="${i}">×</button></li>`).join("")}
          </ul>
        </div>

        <button class="btn primary block" id="rec-save">この日の記録を保存</button>
      </section>`;

    $("#rec-date").onchange = (e) => { recordDate = e.target.value; render(); };
    MEAL_SLOTS.forEach((s) => {
      $(`#add-${s.key}`).onclick = () => openFoodPicker(s);
      $(`#photo-${s.key}`).onclick = () => openPhotoPicker(s);
      $$(`[data-del="${s.key}"]`).forEach((btn) => {
        btn.onclick = () => {
          log.meals[s.key].splice(parseInt(btn.dataset.idx, 10), 1);
          State.save(); render();
        };
      });
    });
    $("#ex-add").onclick = () => {
      const name = $("#ex-name").value;
      const min = parseInt($("#ex-min").value, 10);
      if (!(min > 0)) return alert("運動時間(分)を入力してください。");
      const met = EXERCISE_MET.find((e) => e.name === name);
      log.activity.exercises.push({ name, met: met.met, minutes: min });
      State.save(); render();
    };
    $$(".chips [data-ex]").forEach((b) => {
      b.onclick = () => { log.activity.exercises.splice(parseInt(b.dataset.ex, 10), 1); State.save(); render(); };
    });
    $("#rec-save").onclick = () => {
      log.activity.steps = parseInt($("#ac-steps").value, 10) || 0;
      log.activity.behavior = $("#ac-behavior").value;
      const w = parseFloat($("#ac-weight").value);
      log.weight = w > 0 ? w : null;
      if (w > 0) State.data.profile.weight = w; // 最新体重をプロフィールに反映
      State.save();
      alert("保存しました。ダッシュボードで分析を確認できます。");
      Nav.go("dashboard");
    };
  }
  function renderMealSlot(s, log) {
    const items = log.meals[s.key];
    const t = sumItems(items);
    return `
      <div class="meal">
        <div class="meal-head">
          <span>${s.icon} ${s.label}</span>
          <span class="meal-kcal">${fmt(t.kcal)} kcal</span>
        </div>
        <ul class="items">
          ${items.length ? items.map((it, i) => `
            <li><span>${it.name}${it.qty !== 1 ? ` ×${it.qty}` : ""}</span>
            <span>${fmt(it.kcal * it.qty)}kcal <button data-del="${s.key}" data-idx="${i}">×</button></span></li>`).join("")
            : `<li class="muted">まだ記録がありません</li>`}
        </ul>
        <div class="row">
          <button class="btn sm" id="add-${s.key}">＋ 料理を選ぶ</button>
          <button class="btn sm ai" id="photo-${s.key}">📷 写真で解析</button>
        </div>
      </div>`;
  }

  // ---- 料理選択モーダル ---------------------------------------------------
  function openFoodPicker(slot) {
    const modal = makeModal(`${slot.icon} ${slot.label}に追加`);
    const body = $(".modal-body", modal);
    body.innerHTML = `
      <input type="search" id="fp-q" placeholder="料理名で検索（例: 鮭、サラダ）" autocomplete="off">
      <div id="fp-list" class="fp-list"></div>`;
    const listEl = $("#fp-list", body);
    const draw = (q) => {
      const items = FOODS.filter((f) => !q || f.name.includes(q) || f.cat.includes(q));
      listEl.innerHTML = items.map((f, i) => `
        <button class="fp-item" data-i="${FOODS.indexOf(f)}">
          <span class="fp-name">${f.name}<small>${f.unit}・${f.cat}</small></span>
          <span class="fp-k">${f.kcal}kcal</span>
        </button>`).join("") || `<p class="muted">該当なし。「写真で解析」もお試しください。</p>`;
      $$(".fp-item", listEl).forEach((b) => {
        b.onclick = () => {
          const f = FOODS[parseInt(b.dataset.i, 10)];
          const qty = parseFloat(prompt(`「${f.name}」の量（${f.unit} を1として）`, "1"));
          if (!(qty > 0)) return;
          State.log(recordDate).meals[slot.key].push({ ...f, qty });
          State.save(); modal.remove(); render();
        };
      });
    };
    $("#fp-q", body).oninput = (e) => draw(e.target.value.trim());
    draw("");
  }

  // 現在選択中サービスのAPIキーを返す
  function activeKey() {
    const s = State.data.settings;
    const prov = s.provider || "gemini";
    return (s.keys || {})[prov] || "";
  }

  // ---- 写真AI解析モーダル -------------------------------------------------
  function openPhotoPicker(slot) {
    const modal = makeModal(`📷 ${slot.label}を写真で解析`);
    const body = $(".modal-body", modal);
    const hasKey = !!activeKey();
    body.innerHTML = `
      <p class="muted">料理の写真から、料理名・カロリー・食材・栄養素をAIが推定します。</p>
      <label class="filedrop"><input type="file" id="ph-file" accept="image/*" hidden>
        <span>📷 ライブラリから選ぶ / 撮影する</span></label>
      <div id="ph-preview"></div>
      <div id="ph-status"></div>
      <div id="ph-result"></div>
      ${hasKey ? "" : `<p class="warn-box">⚠️ AI解析には設定画面でAPIキーの登録が必要です（無料のGoogle Geminiも選べます）。未登録の場合は「料理を選ぶ」から手動で追加してください。</p>`}`;
    $("#ph-file", body).onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        $("#ph-preview", body).innerHTML = `<img src="${reader.result}" class="ph-img" alt="preview">`;
        analyzePhoto(reader.result, slot, modal);
      };
      reader.readAsDataURL(file);
    };
  }

  async function analyzePhoto(dataUrl, slot, modal) {
    const statusEl = $("#ph-status", modal);
    const resultEl = $("#ph-result", modal);
    const provider = State.data.settings.provider || "gemini";
    const key = activeKey();
    if (!key) { statusEl.innerHTML = `<p class="muted">選択中のサービスのAPIキーが未設定です。設定画面で登録してください。</p>`; return; }
    statusEl.innerHTML = `<p class="loading">🤖 AIが解析中…（数秒かかります）</p>`;
    resultEl.innerHTML = "";
    const [meta, b64] = dataUrl.split(",");
    const media = (meta.match(/data:(.*?);/) || [])[1] || "image/jpeg";
    const schemaHint = `次のJSON形式のみで回答してください（説明文やコードブロックは不要）:
{"items":[{"name":"料理名","kcal":整数,"p":たんぱく質g,"f":脂質g,"c":炭水化物g,"fiber":食物繊維g,"salt":食塩相当量g,"ingredients":["主な食材",...]}]}
写真に写る料理ごとに1食分の推定値を入れてください。`;
    const prompt = `この料理写真を管理栄養士として分析してください。${schemaHint}`;
    const model = State.data.settings.model || "claude-opus-4-8";
    try {
      const items = provider === "gemini"
        ? await callGemini(key, media, b64, prompt)
        : await callAnthropic(key, media, b64, prompt, model);
      showPhotoResult(items, slot, modal, statusEl, resultEl);
    } catch (e) {
      statusEl.innerHTML = `<p class="warn-box">解析に失敗しました: ${e.message}<br>「料理を選ぶ」から手動で追加してください。</p>`;
    }
  }
  function extractItems(text) {
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    return parsed.items || [];
  }
  // Anthropic Claude で解析（ブラウザ直接呼び出し）
  async function callAnthropic(key, media, b64, prompt, model) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: model || "claude-opus-4-8",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: media, data: b64 } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });
    if (!res.ok) throw new Error(`APIエラー ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const text = (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    return extractItems(text);
  }
  // Google Gemini で解析（無料枠あり）
  async function callGemini(key, media, b64, prompt) {
    const model = "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: media, data: b64 } },
          { text: prompt },
        ] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });
    if (!res.ok) throw new Error(`Geminiエラー ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const text = ((json.candidates || [])[0]?.content?.parts || []).map((p) => p.text || "").join("");
    if (!text) throw new Error("応答が空でした（無料枠の上限や画像内容をご確認ください）");
    return extractItems(text);
  }
  function showPhotoResult(items, slot, modal, statusEl, resultEl) {
    if (!items.length) { statusEl.innerHTML = `<p class="muted">料理を検出できませんでした。</p>`; return; }
    statusEl.innerHTML = `<p class="good-box">✅ ${items.length}品を検出しました。内容を確認して追加してください。</p>`;
    resultEl.innerHTML = items.map((it, i) => `
      <div class="ph-card">
        <div class="row between"><strong>${it.name || "料理"}</strong><span>${fmt(it.kcal || 0)}kcal</span></div>
        <div class="ph-macros">P ${fmt(it.p || 0, 1)}g / F ${fmt(it.f || 0, 1)}g / C ${fmt(it.c || 0, 1)}g ・ 食物繊維 ${fmt(it.fiber || 0, 1)}g ・ 塩分 ${fmt(it.salt || 0, 1)}g</div>
        ${it.ingredients && it.ingredients.length ? `<div class="muted">食材: ${it.ingredients.join("、")}</div>` : ""}
        <button class="btn sm primary" data-add="${i}">＋ ${slot.label}に追加</button>
      </div>`).join("");
    $$("[data-add]", resultEl).forEach((b) => {
      b.onclick = () => {
        const it = items[parseInt(b.dataset.add, 10)];
        State.log(recordDate).meals[slot.key].push({
          name: it.name || "料理", unit: "AI推定 1食",
          kcal: it.kcal || 0, p: it.p || 0, f: it.f || 0, c: it.c || 0,
          fiber: it.fiber || 0, salt: it.salt || 0, qty: 1,
        });
        State.save();
        b.textContent = "追加済み ✓"; b.disabled = true;
        render();
      };
    });
  }

  // ==========================================================================
  //  ダッシュボード（分析・アドバイス）
  // ==========================================================================
  function renderDashboard(view) {
    const p = State.data.profile;
    const date = dashDate;
    const isToday = date === todayStr();
    const log = State.log(date);
    const totals = dayTotals(log);
    const burned = Metrics.burned(p, log.activity);
    const target = Metrics.targetIntake(p, burned.total);
    const nt = Metrics.nutrientTargets(p, target);
    const balance = totals.all.kcal - burned.total; // 摂取 − 消費
    const bmi = Metrics.bmi(p);
    const cat = Metrics.bmiCategory(bmi);

    const balTone = Math.abs(balance) < 150 ? "good" : balance > 0 ? "bad" : "warn";
    const balLabel = balance > 0 ? "摂取オーバー" : "消費が上回る";

    view.innerHTML = `
      <section class="card">
        <div class="row between wrap">
          <h2>${isToday ? "今日" : "この日"}の分析</h2>
          <span class="badge ${cat.tone}">BMI ${fmt(bmi, 1)}・${cat.label}</span>
        </div>
        <div class="row wrap" style="gap:8px;margin:6px 0 12px">
          <input type="date" id="dash-date" value="${date}" max="${todayStr()}">
          ${isToday ? "" : `<button class="btn sm" id="dash-today">今日に戻る</button>`}
        </div>

        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-l">摂取カロリー</div><div class="kpi-v">${fmt(totals.all.kcal)}<small>kcal</small></div></div>
          <div class="kpi"><div class="kpi-l">消費カロリー</div><div class="kpi-v">${fmt(burned.total)}<small>kcal</small></div></div>
          <div class="kpi"><div class="kpi-l">目標摂取</div><div class="kpi-v">${fmt(target)}<small>kcal</small></div></div>
          <div class="kpi ${balTone}"><div class="kpi-l">${balLabel}</div><div class="kpi-v">${balance > 0 ? "+" : ""}${fmt(balance)}<small>kcal</small></div></div>
        </div>

        ${renderBalanceBar(totals.all.kcal, burned.total, target)}

        <h3 class="mt">消費の内訳</h3>
        <div class="breakdown">
          <span>基礎代謝 <b>${fmt(burned.bmr)}</b></span>
          <span>生活活動 <b>${fmt(burned.neat)}</b></span>
          <span>歩数(${fmt(log.activity.steps)}歩) <b>${fmt(burned.stepKcal)}</b></span>
          <span>運動 <b>${fmt(burned.exKcal)}</b></span>
        </div>
      </section>

      <section class="card">
        <h3>栄養バランス（過不足）</h3>
        ${renderNutrientBars(totals.all, nt)}
      </section>

      <section class="card advice">
        <h3>💡 健康アドバイス</h3>
        ${renderAdvice(p, totals, burned, target, nt, balance, date)}
      </section>

      <section class="card">
        <div class="row between"><h3>食事バランス(PFC)</h3></div>
        ${renderPFC(totals.all)}
      </section>`;
    $("#dash-date").onchange = (e) => { dashDate = e.target.value; renderDashboard(view); };
    const backBtn = $("#dash-today");
    if (backBtn) backBtn.onclick = () => { dashDate = todayStr(); renderDashboard(view); };
  }

  function renderBalanceBar(intake, burned, target) {
    const max = Math.max(intake, burned, target, 1) * 1.1;
    const w = (v) => `${Math.min(100, (v / max) * 100)}%`;
    return `
      <div class="balbar">
        <div class="balrow"><span class="bl">摂取</span><div class="track"><div class="fill intake" style="width:${w(intake)}"></div></div><span class="bv">${fmt(intake)}</span></div>
        <div class="balrow"><span class="bl">消費</span><div class="track"><div class="fill burn" style="width:${w(burned)}"></div></div><span class="bv">${fmt(burned)}</span></div>
        <div class="balrow"><span class="bl">目標</span><div class="track"><div class="fill target" style="width:${w(target)}"></div></div><span class="bv">${fmt(target)}</span></div>
      </div>`;
  }

  function renderNutrientBars(all, nt) {
    const rows = [
      { l: "たんぱく質", v: all.p, t: nt.protein, u: "g", type: "min" },
      { l: "脂質", v: all.f, t: nt.fat, u: "g", type: "range" },
      { l: "炭水化物", v: all.c, t: nt.carb, u: "g", type: "range" },
      { l: "食物繊維", v: all.fiber, t: nt.fiber, u: "g", type: "min" },
      { l: "食塩相当量", v: all.salt, t: nt.saltMax, u: "g", type: "max" },
    ];
    return `<div class="nut">${rows.map((r) => {
      const pct = Math.min(150, (r.v / r.t) * 100);
      let tone = "good", note = "適量";
      if (r.type === "min") {
        if (r.v < r.t * 0.8) { tone = "warn"; note = `あと ${fmt(r.t - r.v, 1)}${r.u}`; }
        else note = "十分";
      } else if (r.type === "max") {
        if (r.v > r.t) { tone = "bad"; note = `${fmt(r.v - r.t, 1)}${r.u} 超過`; }
        else note = `上限まで ${fmt(r.t - r.v, 1)}${r.u}`;
      } else {
        if (r.v > r.t * 1.2) { tone = "warn"; note = "やや多い"; }
        else if (r.v < r.t * 0.7) { tone = "warn"; note = "やや少ない"; }
      }
      return `<div class="nut-row">
        <div class="nut-l">${r.l}</div>
        <div class="nut-track"><div class="nut-fill ${tone}" style="width:${Math.min(100, pct)}%"></div>
          ${r.type === "max" ? `<div class="nut-limit" style="left:100%"></div>` : ""}</div>
        <div class="nut-v">${fmt(r.v, 1)}/${fmt(r.t, r.type === "max" ? 1 : 0)}${r.u}<span class="badge ${tone} sm">${note}</span></div>
      </div>`;
    }).join("")}</div>`;
  }

  function renderPFC(all) {
    const pk = all.p * 4, fk = all.f * 9, ck = all.c * 4;
    const tot = pk + fk + ck || 1;
    const seg = (v, cls, label) => `<div class="pfc-seg ${cls}" style="width:${(v / tot) * 100}%" title="${label}"></div>`;
    return `
      <div class="pfc-bar">${seg(pk, "p", "P")}${seg(fk, "f", "F")}${seg(ck, "c", "C")}</div>
      <div class="pfc-legend">
        <span><i class="dot p"></i>たんぱく質 ${fmt(pk / tot * 100)}%</span>
        <span><i class="dot f"></i>脂質 ${fmt(fk / tot * 100)}%</span>
        <span><i class="dot c"></i>炭水化物 ${fmt(ck / tot * 100)}%</span>
      </div>
      <p class="muted">理想の目安 P:F:C ≒ 15:25:60（%エネルギー）</p>`;
  }

  // ---- アドバイス生成エンジン（ルールベース） -----------------------------
  function renderAdvice(p, totals, burned, target, nt, balance, date) {
    const a = [];
    const all = totals.all;
    const remaining = target - all.kcal; // 目標までの残り
    const loggedMeals = MEAL_SLOTS.filter((s) => totals.slots[s.key].kcal > 0);

    // 1. カロリー過不足
    if (all.kcal === 0) {
      a.push(["info", "まだ食事が記録されていません。「記録する」から今日の食事を追加すると分析が始まります。"]);
    } else if (balance > 300) {
      a.push(["bad", `摂取が消費を <b>${fmt(balance)}kcal</b> 上回っています。この状態が続くと約 ${fmt(balance * 30 / 7200, 1)}kg/月 の増加ペースです。夕食は揚げ物や主食を控えめにしましょう。`]);
    } else if (balance < -400) {
      a.push(["warn", `消費が摂取を <b>${fmt(-balance)}kcal</b> 上回っています。減量には有効ですが、極端な不足は筋肉量の低下につながります。たんぱく質を確保しましょう。`]);
    } else {
      a.push(["good", `カロリー収支は <b>${balance > 0 ? "+" : ""}${fmt(balance)}kcal</b>。目標に対して良好なバランスです。`]);
    }

    // 2. たんぱく質
    if (all.p < nt.protein * 0.8 && all.kcal > 0) {
      a.push(["warn", `たんぱく質が不足気味（${fmt(all.p, 0)}/${fmt(nt.protein, 0)}g）。<b>鶏むね肉・刺身・納豆・卵</b>などを足すと効率よく補えます。`]);
    }
    // 3. 脂質
    if (all.f > nt.fat * 1.3) {
      a.push(["warn", `脂質が多め（${fmt(all.f, 0)}g）。揚げ物や脂身を控え、蒸す・焼く調理に変えると抑えられます。`]);
    }
    // 4. 塩分
    if (all.salt > nt.saltMax) {
      a.push(["bad", `塩分が上限を <b>${fmt(all.salt - nt.saltMax, 1)}g</b> 超過。汁物を半量にする、麺類の汁を残すなどで減塩を。高血圧予防に重要です。`]);
    }
    // 5. 食物繊維
    if (all.fiber < nt.fiber * 0.7 && all.kcal > 0) {
      a.push(["warn", `食物繊維が不足（${fmt(all.fiber, 0)}/${fmt(nt.fiber, 0)}g）。<b>野菜・海藻・きのこ・玄米</b>を意識すると腸内環境と血糖コントロールに役立ちます。`]);
    }

    // 6. 次の食事は何を食べたら良いか
    a.push(["info", nextMealSuggestion(all, nt, remaining, loggedMeals)]);

    // 7. 体重トレンド
    const trend = weightTrend(date, 7);
    if (trend) a.push([trend.tone, trend.msg]);

    return a.map(([tone, msg]) => `<div class="advice-item ${tone}"><span class="ai-icon">${adviceIcon(tone)}</span><span>${msg}</span></div>`).join("");
  }
  function adviceIcon(t) { return { good: "✅", warn: "⚠️", bad: "🚫", info: "🍽️" }[t] || "•"; }

  function nextMealSuggestion(all, nt, remaining, loggedMeals) {
    const nextSlot = MEAL_SLOTS.find((s) => !loggedMeals.some((m) => m.key === s.key) && s.key !== "snack");
    const slotName = nextSlot ? nextSlot.label : "次の食事";
    const needs = [];
    if (all.p < nt.protein * 0.8) needs.push("たんぱく質");
    if (all.fiber < nt.fiber * 0.7) needs.push("食物繊維");
    const picks = [];
    if (needs.includes("たんぱく質")) picks.push("焼き鮭・鶏むね肉・冷奴");
    if (needs.includes("食物繊維")) picks.push("野菜炒め・ひじきの煮物・きのこソテー");
    if (remaining < 200 && all.kcal > 0) {
      return `<b>${slotName}の提案:</b> 目標までの残りは <b>${fmt(remaining)}kcal</b> と少なめ。味噌汁＋サラダ＋豆腐など、低カロリー高たんぱくで軽めにまとめましょう。`;
    }
    if (picks.length) {
      return `<b>${slotName}の提案:</b> 残り約 <b>${fmt(Math.max(remaining, 0))}kcal</b>。不足しがちな${needs.join("・")}を補うため、${picks.join(" / ")} などがおすすめです。`;
    }
    return `<b>${slotName}の提案:</b> 残り約 <b>${fmt(Math.max(remaining, 0))}kcal</b>。主食・主菜・副菜をそろえ、野菜を1品加えるとバランスが整います。`;
  }

  function weightTrend(date, days) {
    const logs = State.data.logs;
    const series = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(date); d.setDate(d.getDate() - i);
      const k = d.toISOString().slice(0, 10);
      if (logs[k] && logs[k].weight != null) series.push(logs[k].weight);
    }
    if (series.length < 2) return null;
    const diff = series[series.length - 1] - series[0];
    const p = State.data.profile;
    if (p.targetWeight) {
      const toGo = p.weight - p.targetWeight;
      if (Math.abs(toGo) < 0.3) return { tone: "good", msg: `🎉 目標体重(${p.targetWeight}kg)を達成しています。今のペースを維持しましょう。` };
    }
    if (Math.abs(diff) < 0.3) return { tone: "info", msg: `直近${series.length}回の体重はほぼ横ばい（${diff >= 0 ? "+" : ""}${fmt(diff, 1)}kg）。` };
    return {
      tone: diff < 0 ? "good" : "warn",
      msg: `直近の体重は <b>${diff > 0 ? "+" : ""}${fmt(diff, 1)}kg</b> ${diff < 0 ? "減少傾向。順調です。" : "増加傾向。摂取と運動を見直しましょう。"}`,
    };
  }

  // ==========================================================================
  //  推移グラフ（日・週・月・年）
  // ==========================================================================
  let trendPeriod = "week";
  function renderTrend(view) {
    view.innerHTML = `
      <section class="card">
        <div class="row between wrap">
          <h2>推移グラフ</h2>
          <div class="seg">
            ${[["day", "日"], ["week", "週"], ["month", "月"], ["year", "年"]].map(([k, l]) =>
              `<button class="seg-btn ${trendPeriod === k ? "active" : ""}" data-p="${k}">${l}</button>`).join("")}
          </div>
        </div>
        <p class="muted">摂取カロリー（朝・昼・晩・間食の積み上げ）と消費カロリー、体重変化を並べて可視化します。</p>
        <div class="chart-legend">
          <span><i class="dot br"></i>朝</span><span><i class="dot lu"></i>昼</span>
          <span><i class="dot di"></i>晩</span><span><i class="dot sn"></i>間食</span>
          <span><i class="line burn"></i>消費</span><span><i class="line wt"></i>体重</span>
        </div>
        <canvas id="chart" height="320"></canvas>
        <div id="chart-note" class="muted"></div>
      </section>`;
    $$(".seg-btn").forEach((b) => (b.onclick = () => { trendPeriod = b.dataset.p; renderTrend(view); }));
    drawChart();
  }

  function buildSeries() {
    const logs = State.data.logs;
    const p = State.data.profile;
    const buckets = [];
    const now = new Date();
    const push = (label, keys) => {
      let br = 0, lu = 0, di = 0, sn = 0, burn = 0, wSum = 0, wN = 0, dN = 0;
      keys.forEach((k) => {
        const l = logs[k];
        if (!l) return;
        dN++;
        const t = dayTotals(l);
        br += t.slots.breakfast.kcal; lu += t.slots.lunch.kcal;
        di += t.slots.dinner.kcal; sn += t.slots.snack.kcal;
        burn += Metrics.burned(p, l.activity).total;
        if (l.weight != null) { wSum += l.weight; wN++; }
      });
      const div = trendPeriod === "day" ? 1 : Math.max(dN, 1);
      buckets.push({
        label, br: br / div, lu: lu / div, di: di / div, sn: sn / div,
        burn: dN ? burn / div : 0, weight: wN ? wSum / wN : null, hasData: dN > 0,
      });
    };
    if (trendPeriod === "day") {
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now); d.setDate(d.getDate() - i);
        push(`${d.getMonth() + 1}/${d.getDate()}`, [d.toISOString().slice(0, 10)]);
      }
    } else if (trendPeriod === "week") {
      for (let i = 7; i >= 0; i--) {
        const end = new Date(now); end.setDate(end.getDate() - i * 7);
        const keys = [];
        for (let j = 0; j < 7; j++) { const d = new Date(end); d.setDate(d.getDate() - j); keys.push(d.toISOString().slice(0, 10)); }
        push(`${end.getMonth() + 1}/${end.getDate()}週`, keys);
      }
    } else if (trendPeriod === "month") {
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const keys = [];
        const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        for (let day = 1; day <= dim; day++) keys.push(new Date(d.getFullYear(), d.getMonth(), day).toISOString().slice(0, 10));
        push(`${d.getFullYear() % 100}/${d.getMonth() + 1}`, keys);
      }
    } else {
      for (let i = 4; i >= 0; i--) {
        const y = now.getFullYear() - i;
        const keys = Object.keys(logs).filter((k) => k.startsWith(String(y)));
        push(`${y}年`, keys);
      }
    }
    return buckets;
  }

  function drawChart() {
    const canvas = $("#chart");
    if (!canvas) return;
    const data = buildSeries();
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.parentElement.clientWidth;
    const cssH = 320;
    canvas.width = cssW * dpr; canvas.height = cssH * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    const padL = 44, padR = 44, padT = 20, padB = 40;
    const plotW = cssW - padL - padR, plotH = cssH - padT - padB;
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const axis = dark ? "#556" : "#c9d2dc", text = dark ? "#9fb0c0" : "#6b7785";

    const maxKcal = Math.max(2000, ...data.map((d) => d.br + d.lu + d.di + d.sn), ...data.map((d) => d.burn)) * 1.1;
    const weights = data.map((d) => d.weight).filter((w) => w != null);
    const wMin = weights.length ? Math.min(...weights) - 1 : 0;
    const wMax = weights.length ? Math.max(...weights) + 1 : 1;

    // グリッド + 左軸(kcal)
    ctx.strokeStyle = axis; ctx.fillStyle = text; ctx.font = "11px sans-serif"; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH / 4) * i;
      ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(cssW - padR, y); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.textAlign = "right"; ctx.fillText(fmt(maxKcal * (1 - i / 4)), padL - 6, y + 3);
    }
    // 右軸(体重)
    if (weights.length) {
      ctx.textAlign = "left";
      for (let i = 0; i <= 4; i++) {
        const y = padT + (plotH / 4) * i;
        ctx.fillText(fmt(wMax - (wMax - wMin) * (i / 4), 1), cssW - padR + 6, y + 3);
      }
    }

    const n = data.length;
    const slotW = plotW / n;
    const barW = Math.min(28, slotW * 0.55);
    const colors = { br: "#f6c453", lu: "#67b26f", di: "#4a90d9", sn: "#c56cf0" };
    const y0 = padT + plotH;

    // 積み上げ棒(摂取)
    data.forEach((d, i) => {
      const cx = padL + slotW * (i + 0.5);
      let acc = 0;
      [["br", d.br], ["lu", d.lu], ["di", d.di], ["sn", d.sn]].forEach(([k, v]) => {
        const h = (v / maxKcal) * plotH;
        ctx.fillStyle = colors[k];
        ctx.fillRect(cx - barW / 2, y0 - acc - h, barW, h);
        acc += h;
      });
      // x軸ラベル
      ctx.fillStyle = text; ctx.textAlign = "center";
      if (n <= 14 || i % Math.ceil(n / 12) === 0) ctx.fillText(d.label, cx, cssH - padB + 16);
    });

    // 消費ライン
    ctx.strokeStyle = "#e0564f"; ctx.lineWidth = 2; ctx.beginPath();
    data.forEach((d, i) => {
      const cx = padL + slotW * (i + 0.5);
      const y = y0 - (d.burn / maxKcal) * plotH;
      i === 0 ? ctx.moveTo(cx, y) : ctx.lineTo(cx, y);
    });
    ctx.stroke();
    data.forEach((d, i) => {
      if (!d.burn) return;
      const cx = padL + slotW * (i + 0.5);
      const y = y0 - (d.burn / maxKcal) * plotH;
      ctx.fillStyle = "#e0564f"; ctx.beginPath(); ctx.arc(cx, y, 2.5, 0, 7); ctx.fill();
    });

    // 体重ライン(右軸)
    if (weights.length) {
      ctx.strokeStyle = "#2bb3a3"; ctx.lineWidth = 2; ctx.setLineDash([5, 3]); ctx.beginPath();
      let started = false;
      data.forEach((d, i) => {
        if (d.weight == null) return;
        const cx = padL + slotW * (i + 0.5);
        const y = padT + (1 - (d.weight - wMin) / (wMax - wMin)) * plotH;
        started ? ctx.lineTo(cx, y) : ctx.moveTo(cx, y); started = true;
      });
      ctx.stroke(); ctx.setLineDash([]);
      data.forEach((d, i) => {
        if (d.weight == null) return;
        const cx = padL + slotW * (i + 0.5);
        const y = padT + (1 - (d.weight - wMin) / (wMax - wMin)) * plotH;
        ctx.fillStyle = "#2bb3a3"; ctx.beginPath(); ctx.arc(cx, y, 3, 0, 7); ctx.fill();
      });
    }

    const filled = data.filter((d) => d.hasData).length;
    $("#chart-note").textContent = filled
      ? `左軸=カロリー(kcal) / 右軸=体重(kg)。記録のある期間: ${filled}区間。`
      : "この期間の記録がありません。「記録する」からデータを追加してください。";
  }

  // ==========================================================================
  //  設定
  // ==========================================================================
  // AIサービスの選択肢定義（1つのドロップダウンで3択）
  const AI_CHOICES = {
    gemini: {
      label: "Google Gemini（無料）", provider: "gemini", model: null,
      ph: "AIza...", link: "https://aistudio.google.com/app/apikey", linkName: "Google AI Studio",
      note: "無料枠内なら課金なしで使えます（1日あたりの回数制限あり）。まずはこれがおすすめ。",
    },
    "claude-opus-4-8": {
      label: "Claude 高精度（Opus・有料）", provider: "anthropic", model: "claude-opus-4-8",
      ph: "sk-ant-...", link: "https://console.anthropic.com/settings/keys", linkName: "Anthropic Console",
      note: "推定精度は高め。料金の目安は写真1枚あたり約¥3〜5（従量課金・残高登録が必要）。",
    },
    "claude-haiku-4-5": {
      label: "Claude 低コスト（Haiku・有料）", provider: "anthropic", model: "claude-haiku-4-5",
      ph: "sk-ant-...", link: "https://console.anthropic.com/settings/keys", linkName: "Anthropic Console",
      note: "精度はやや控えめだが安価。料金の目安は写真1枚あたり約¥1弱（従量課金・残高登録が必要）。",
    },
  };
  function currentAiKey(s) {
    if ((s.provider || "gemini") === "gemini") return "gemini";
    return s.model || "claude-opus-4-8";
  }
  function renderSettings(view) {
    const s = State.data.settings;
    const aiKey = currentAiKey(s);
    const info = AI_CHOICES[aiKey];
    const keys = s.keys || { gemini: "", anthropic: "" };
    const has = (p) => (keys[p] ? "✅登録済み" : "未登録");
    const dayCount = Object.keys(State.data.logs).filter((k) => dayTotals(State.log(k)).all.kcal > 0).length;
    view.innerHTML = `
      <section class="card">
        <h2>設定</h2>
        <h3>写真AI解析（任意）</h3>
        <p class="muted">料理写真からカロリー・食材・栄養素を自動推定します。APIキーはこの端末のブラウザ内（localStorage）にのみ保存され、
          外部へ送られるのは解析時に選んだAIサービスへの通信だけです。</p>

        <label class="block">使うAIサービス（切り替えると対応キーを自動使用）
          <select id="set-ai">
            ${Object.entries(AI_CHOICES).map(([k, v]) => `<option value="${k}" ${aiKey === k ? "selected" : ""}>${v.label}</option>`).join("")}
          </select>
        </label>
        <p class="muted">現在: <b>${info.label}</b> — ${info.note}</p>

        <h4 class="mt">APIキー（両方まとめて登録しておけます）</h4>
        <label class="block">Google Gemini のキー <span class="badge ${keys.gemini ? "good" : "warn"} sm">${has("gemini")}</span>
          <input type="password" id="key-gemini" value="${keys.gemini || ""}" placeholder="AIza...">
        </label>
        <p class="muted"><a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">Google AI Studio</a> で無料取得</p>
        <label class="block">Anthropic Claude のキー <span class="badge ${keys.anthropic ? "good" : "warn"} sm">${has("anthropic")}</span>
          <input type="password" id="key-anthropic" value="${keys.anthropic || ""}" placeholder="sk-ant-...">
        </label>
        <p class="muted"><a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic Console</a> で取得（高精度Opus / 低コストHaiku 共通）</p>

        <button class="btn primary" id="set-save">保存する</button>
        <p class="muted">未設定でも手動記録・分析・グラフはすべて利用できます。</p>
      </section>

      <section class="card">
        <h3>📲 iPhoneヘルスケアの歩数を取り込む</h3>
        <p class="muted">SafariはiPhoneのヘルスケアを直接読めないため、「ショートカット」アプリで橋渡しします。
          下のURLを歩数付きで開くと、その日の歩数を自動記録します（末尾の数字が歩数）。</p>
        <p class="urlbox" id="hk-url">${location.origin}${location.pathname}?steps=8000</p>
        <button class="btn sm" id="hk-copy">連携用URLの雛形をコピー</button>
        <p class="muted">ショートカットの作り方: ①「ヘルスケアサンプルを検索」で歩数・当日・合計を取得 →
          ②「URLを開く」で <code>${location.origin}${location.pathname}?steps=</code> の後ろに①の結果を付ける。
          自動化(オートメーション)で毎晩実行すれば、開くだけで歩数が入ります。</p>
      </section>

      <section class="card">
        <h3>データ管理</h3>
        <p class="muted">記録済みの日数: <b>${dayCount}日</b></p>
        <div class="row wrap">
          <button class="btn" id="set-export">JSONで書き出し</button>
          <label class="btn">JSONを読み込み<input type="file" id="set-import" accept="application/json" hidden></label>
          <button class="btn danger" id="set-reset">全データを消去</button>
        </div>
      </section>`;
    const applyChoice = (k) => {
      const c = AI_CHOICES[k];
      State.data.settings.provider = c.provider;
      State.data.settings.model = c.model;
    };
    const saveKeys = () => {
      State.data.settings.keys = {
        gemini: $("#key-gemini").value.trim(),
        anthropic: $("#key-anthropic").value.trim(),
      };
    };
    $("#set-ai").onchange = (e) => {
      saveKeys();                 // 入力中のキーを失わない
      applyChoice(e.target.value); // 対応キーへ自動で切り替え
      State.save(); renderSettings(view);
    };
    $("#set-save").onclick = () => {
      applyChoice($("#set-ai").value);
      saveKeys();
      State.save(); alert("保存しました。選択中のサービスとキーで解析します。");
    };
    $("#hk-copy").onclick = () => {
      const url = `${location.origin}${location.pathname}?steps=`;
      const done = () => alert(`コピーしました:\n${url}[歩数]\n\n末尾に歩数を付けて開くと記録されます。`);
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, done); else done();
    };
    $("#set-export").onclick = () => {
      const blob = new Blob([JSON.stringify(State.data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `meal-health-${todayStr()}.json`; a.click();
    };
    $("#set-import").onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try { State.data = JSON.parse(r.result); State.save(); alert("読み込みました。"); render(); }
        catch (_) { alert("読み込みに失敗しました。"); }
      };
      r.readAsText(f);
    };
    $("#set-reset").onclick = () => {
      if (confirm("すべての記録を消去します。よろしいですか？")) {
        localStorage.removeItem(STORE_KEY); State.load(); render();
      }
    };
  }

  // ---- モーダル生成 -------------------------------------------------------
  function makeModal(title) {
    const el = document.createElement("div");
    el.className = "modal-bg";
    el.innerHTML = `<div class="modal"><div class="modal-head"><h3>${title}</h3><button class="modal-x">×</button></div><div class="modal-body"></div></div>`;
    el.onclick = (e) => { if (e.target === el || e.target.classList.contains("modal-x")) el.remove(); };
    document.body.appendChild(el);
    return el;
  }

  // ---- URLパラメータからの歩数取り込み（iPhoneショートカット連携） --------
  // 例: .../meal/?steps=8000&date=2026-07-24  で開くと、その日の歩数を自動記録
  // 各種の日付表記を YYYY-MM-DD に正規化（ショートカットの形式差を吸収）
  function normalizeDate(s) {
    if (!s) return null;
    s = String(s).trim();
    // 2026-07-20 / 2026/07/20 / 2026.07.20 / 2026年7月20日 / 2026-7-20 / 先頭に日付を含む日時
    let m = s.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
    const d = new Date(s); // 最後の手段（ローカル日付で解釈し時差ズレを防ぐ）
    if (!isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return null;
  }
  function importFromURL() {
    const q = new URLSearchParams(location.search);
    const steps = parseInt(q.get("steps"), 10);
    if (!(steps >= 0)) return null;
    const date = normalizeDate(q.get("date")) || todayStr();
    const l = State.log(date);
    l.activity.steps = steps;
    // 体重も一緒に渡された場合は記録（任意）
    const w = parseFloat(q.get("weight"));
    if (w > 0) { l.weight = w; if (date === todayStr() && State.data.profile) State.data.profile.weight = w; }
    State.save();
    // クエリを消してリロード時の二重取り込みを防ぐ
    if (history.replaceState) history.replaceState(null, "", location.pathname + location.hash);
    return { steps, date, weight: w > 0 ? w : null };
  }

  // ---- 起動 ---------------------------------------------------------------
  State.load();
  const imported = importFromURL();
  if (imported) { dashDate = imported.date; Nav.current = "dashboard"; }
  render();
  if (imported) {
    setTimeout(() => alert(
      `ヘルスケアの歩数 ${imported.steps.toLocaleString("ja-JP")}歩 を ${imported.date} に記録しました。` +
      (imported.weight ? `\n体重 ${imported.weight}kg も記録しました。` : "")), 100);
  }
  window.addEventListener("resize", () => { if (Nav.current === "trend") drawChart(); });
})();

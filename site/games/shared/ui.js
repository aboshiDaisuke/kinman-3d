// ミニゲーム共通の画面まわり: 上部バー、スタート画面、カウントダウン、判定の文字、結果画面、ベスト記録。
//
//   const ui = createUI({ id: "yakiin", title: "焼き印", hud: [{ key: "time", label: "のこり" }, ...] });
//   await ui.start({ lead: "...", rules: ["...", "..."] });   // スタートボタンが押されるまで待つ
//   await ui.countdown();
//   ui.set("time", "30");
//   ui.pop("極上！", x, y, "great");
//   const next = await ui.result({ score, unit: "点", rank, detail, share });  // "retry" | "menu"
import { sfx } from "./sfx.js";
import { bgm } from "./bgm.js";

export { sfx, bgm };

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const SPEAKER_ON =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const SPEAKER_OFF =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M17 9.5l5 5M22 9.5l-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

export function bestKey(id) {
  return `kinman-games:${id}:best`;
}
export function getBest(id) {
  try {
    const v = localStorage.getItem(bestKey(id));
    return v === null ? null : JSON.parse(v);
  } catch {
    return null;
  }
}
/** 記録を更新したら true。lowerIsBetter はタイムなど小さいほど良いもの */
export function saveBest(id, score, lowerIsBetter = false) {
  const b = getBest(id);
  const better = b === null || (lowerIsBetter ? score < b : score > b);
  if (better) {
    try {
      localStorage.setItem(bestKey(id), JSON.stringify(score));
    } catch {}
  }
  return better;
}

/**
 * music: BGM の曲名（bgm.js の SONGS。省略時は id）。スタートとカウントダウンで流れ始め、結果画面で止まる。
 * 途中で止めたいとき（「おしまい！」など）は ui.music.stop()、テンポは ui.music.tempo(1.1)。
 */
export function createUI({ id, title, hud = [], lowerIsBetter = false, formatBest = (v) => String(v), bestLabel = "ベスト", music = id }) {
  document.body.classList.add("g-body");

  // ---- 上部バー
  const top = el("header", "g-top");
  const back = el("a", "g-back", '<span aria-hidden="true">←</span> ミニゲーム');
  back.href = "../";
  const h1 = el("h1", "g-title", title);
  const hudBox = el("div", "g-hud");
  const hudItems = {};
  for (const h of hud) {
    const item = el("div", "g-hud-item");
    item.innerHTML = `<span class="g-hud-label">${h.label}</span><span class="g-hud-value">${h.value ?? "-"}</span>`;
    hudBox.append(item);
    hudItems[h.key] = item.querySelector(".g-hud-value");
  }
  const mute = el("button", "g-icon");
  mute.type = "button";
  const syncMute = () => {
    mute.innerHTML = sfx.muted ? SPEAKER_OFF : SPEAKER_ON;
    mute.setAttribute("aria-label", sfx.muted ? "音を出す" : "音を消す");
    mute.setAttribute("aria-pressed", String(sfx.muted));
  };
  mute.addEventListener("click", () => {
    sfx.setMuted(!sfx.muted);
    syncMute();
  });
  syncMute();
  const left = el("div", "g-top-left");
  left.append(back, h1);
  top.append(left, hudBox, mute);
  document.body.append(top);

  // ---- 判定の文字などを出す層
  const fx = el("div", "g-fx");
  fx.setAttribute("aria-hidden", "true");
  document.body.append(fx);
  const live = el("div", "g-sr");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  document.body.append(live);

  // ---- 重ねる画面（スタート・結果）
  const overlay = el("section", "g-overlay");
  overlay.hidden = true;
  document.body.append(overlay);

  function showOverlay(html) {
    overlay.innerHTML = html;
    overlay.hidden = false;
    overlay.classList.remove("g-leave");
    void overlay.offsetWidth;
    overlay.classList.add("g-enter");
    return overlay;
  }
  function hideOverlay() {
    return new Promise((res) => {
      overlay.classList.remove("g-enter");
      overlay.classList.add("g-leave");
      setTimeout(() => {
        overlay.hidden = true;
        overlay.classList.remove("g-leave");
        res();
      }, 220);
    });
  }

  const bestText = () => {
    const b = getBest(id);
    return b === null ? "" : `<p class="g-best">${bestLabel} <strong>${formatBest(b)}</strong></p>`;
  };

  const ui = {
    overlay,
    music: {
      play: () => bgm.play(music),
      stop: (fade = 0.6) => bgm.stop(fade),
      tempo: (m) => bgm.tempo(m),
    },
    fxLayer: fx,
    set(key, value) {
      if (hudItems[key]) hudItems[key].textContent = value;
    },
    announce(text) {
      live.textContent = text;
    },

    /** スタート画面。options: [{ value, label }] があれば選択肢を出し、選んだ value を返す */
    start({ lead = "", rules = [], button = "はじめる", options = null, optionLabel = "", extra = "" } = {}) {
      const opts = options
        ? `<fieldset class="g-options"><legend>${optionLabel}</legend>${options
            .map(
              (o, i) =>
                `<label class="g-option"><input type="radio" name="g-opt" value="${o.value}" ${i === Math.max(0, options.findIndex((x) => x.checked)) ? "checked" : ""}><span>${o.label}</span>${o.note ? `<small>${o.note}</small>` : ""}</label>`
            )
            .join("")}</fieldset>`
        : "";
      const o = showOverlay(`
        <div class="g-card">
          <p class="g-kicker">金萬ミニゲーム</p>
          <h2 class="g-card-title">${title}</h2>
          ${lead ? `<p class="g-lead">${lead}</p>` : ""}
          ${rules.length ? `<ul class="g-rules">${rules.map((r) => `<li>${r}</li>`).join("")}</ul>` : ""}
          ${opts}
          ${extra}
          ${bestText()}
          <div class="g-actions"><button type="button" class="g-btn g-primary" data-act="start">${button}</button></div>
        </div>`);
      const btn = o.querySelector('[data-act="start"]');
      setTimeout(() => btn.focus({ preventScroll: true }), 50);
      return new Promise((res) => {
        btn.addEventListener(
          "click",
          async () => {
            sfx.unlock();
            sfx.tap();
            const v = o.querySelector('input[name="g-opt"]:checked')?.value ?? null;
            bgm.play(music);
            await hideOverlay();
            res(v);
          },
          { once: true }
        );
      });
    },

    /** 3・2・1・はじめ！ */
    async countdown(words = ["3", "2", "1"], goWord = "はじめ！") {
      bgm.play(music);
      for (const w of words) {
        ui.big(w, "count");
        sfx.count(false);
        await wait(620);
      }
      ui.big(goWord, "go");
      sfx.count(true);
      await wait(350);
    },

    /** 画面中央に大きく叩きつける文字 */
    big(text, kind = "") {
      const e = el("div", `g-big ${kind}`, text);
      fx.append(e);
      setTimeout(() => e.remove(), 1000);
    },

    /** 画面上の (x, y) に判定の文字を出す。kind: great / good / ok / bad */
    pop(text, x, y, kind = "good") {
      const e = el("div", `g-pop ${kind}`, text);
      e.style.left = `${x}px`;
      e.style.top = `${y}px`;
      e.style.setProperty("--r", `${(Math.random() - 0.5) * 14}deg`);
      fx.append(e);
      setTimeout(() => e.remove(), 1100);
    },

    /** 画面を揺らす */
    shake(amp = 8) {
      document.body.style.setProperty("--shake", `${amp}px`);
      document.body.classList.remove("g-shake");
      void document.body.offsetWidth;
      document.body.classList.add("g-shake");
    },

    /** 結果画面。戻り値は "retry" か "menu" */
    /** bestValue に null を渡すと記録しない。newBestText は記録を更新したときの一言（通算の数などで言い換える） */
    result({ score, unit = "", label = "スコア", rank = "", comment = "", detail = "", share = "", bestValue = score, newBestText = "ベスト更新！" }) {
      const isBest = bestValue === null ? false : saveBest(id, bestValue, lowerIsBetter);
      bgm.stop(0.3);
      sfx.fanfare();
      const o = showOverlay(`
        <div class="g-card g-result">
          <p class="g-kicker">${title}</p>
          ${rank ? `<p class="g-rank">${rank}</p>` : ""}
          <p class="g-score"><span class="g-score-label">${label}</span><strong>${score}</strong><span class="g-unit">${unit}</span></p>
          ${isBest ? `<p class="g-newbest">${newBestText}</p>` : bestText()}
          ${comment ? `<p class="g-lead">${comment}</p>` : ""}
          ${detail ? `<div class="g-detail">${detail}</div>` : ""}
          <div class="g-actions">
            <button type="button" class="g-btn g-primary" data-act="retry">もう一回</button>
            ${share ? '<button type="button" class="g-btn" data-act="share">結果をシェア</button>' : ""}
            <button type="button" class="g-btn" data-act="menu">ミニゲーム一覧へ</button>
          </div>
        </div>`);
      const retry = o.querySelector('[data-act="retry"]');
      setTimeout(() => retry.focus({ preventScroll: true }), 50);
      ui.announce(`${label} ${score}${unit} ${rank}`);
      const shareBtn = o.querySelector('[data-act="share"]');
      shareBtn?.addEventListener("click", async () => {
        const text = `${share}\n${location.href}`;
        try {
          if (navigator.share) await navigator.share({ text });
          else {
            await navigator.clipboard.writeText(text);
            shareBtn.textContent = "コピーしました";
          }
        } catch {}
      });
      return new Promise((res) => {
        retry.addEventListener("click", async () => {
          sfx.tap();
          await hideOverlay();
          res("retry");
        });
        o.querySelector('[data-act="menu"]').addEventListener("click", () => {
          location.href = "../";
          res("menu");
        });
      });
    },

    hideOverlay,
  };
  return ui;
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 読み込み中の表示。done() で消える */
export function loading(text = "焼き上げ中…") {
  const e = el("div", "g-loading", `<span class="g-loading-mark" aria-hidden="true"></span><span>${text}</span>`);
  e.setAttribute("role", "status");
  document.body.append(e);
  return {
    done() {
      e.classList.add("done");
      setTimeout(() => e.remove(), 600);
    },
    fail(msg = "読み込みに失敗しました") {
      e.lastChild.textContent = msg;
    },
  };
}

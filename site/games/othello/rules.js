// 金萬オセロの盤面ルール（描画とは切り離した純粋な計算）。
// 盤は長さ 64 の配列。i = 行 * 8 + 列（行 0 が奥、列 0 が左）。0 = 空、1 = 表（先手）、2 = 裏（後手）
export const EMPTY = 0;
export const OMOTE = 1;
export const URA = 2;
export const other = (p) => 3 - p;

const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

export function initialBoard() {
  const b = new Int8Array(64);
  b[27] = URA;
  b[36] = URA;
  b[28] = OMOTE;
  b[35] = OMOTE;
  return b;
}

/** i に p を置いたときに返る石。置けなければ空配列。近い順（方向ごと）に並ぶ */
export function flipsOf(b, i, p) {
  if (b[i] !== EMPTY) return [];
  const o = 3 - p;
  const r0 = i >> 3;
  const c0 = i & 7;
  const out = [];
  for (const [dr, dc] of DIRS) {
    let r = r0 + dr;
    let c = c0 + dc;
    let n = 0;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && b[r * 8 + c] === o) {
      r += dr;
      c += dc;
      n++;
    }
    if (n > 0 && r >= 0 && r < 8 && c >= 0 && c < 8 && b[r * 8 + c] === p) {
      for (let k = 1; k <= n; k++) out.push((r0 + dr * k) * 8 + (c0 + dc * k));
    }
  }
  return out;
}

/** 置けるかどうかだけ（配列を作らない） */
export function canPlace(b, i, p) {
  if (b[i] !== EMPTY) return false;
  const o = 3 - p;
  const r0 = i >> 3;
  const c0 = i & 7;
  for (const [dr, dc] of DIRS) {
    let r = r0 + dr;
    let c = c0 + dc;
    let n = 0;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && b[r * 8 + c] === o) {
      r += dr;
      c += dc;
      n++;
    }
    if (n > 0 && r >= 0 && r < 8 && c >= 0 && c < 8 && b[r * 8 + c] === p) return true;
  }
  return false;
}

export function legalMoves(b, p) {
  const out = [];
  for (let i = 0; i < 64; i++) if (canPlace(b, i, p)) out.push(i);
  return out;
}

export function countMoves(b, p) {
  let n = 0;
  for (let i = 0; i < 64; i++) if (canPlace(b, i, p)) n++;
  return n;
}

export function count(b) {
  let a = 0;
  let u = 0;
  for (let i = 0; i < 64; i++) {
    if (b[i] === OMOTE) a++;
    else if (b[i] === URA) u++;
  }
  return { omote: a, ura: u, empty: 64 - a - u };
}

/** 置いて返す。返した石の配列を返す（盤は書き換わる） */
export function play(b, i, p) {
  const f = flipsOf(b, i, p);
  if (!f.length) return f;
  b[i] = p;
  for (const j of f) b[j] = p;
  return f;
}

/** 行・列から「d3」のような呼び名 */
export const cellName = (i) => "abcdefgh"[i & 7] + ((i >> 3) + 1);

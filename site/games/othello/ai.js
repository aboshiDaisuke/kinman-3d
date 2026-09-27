// CPU の手を決める。ワーカーとして動かすと描画を止めずに読める（読み込み失敗時はそのまま import して使う）
import { EMPTY, flipsOf, legalMoves, countMoves, count } from "./rules.js";

// 位置の重み（角は大きく、角の隣は危険）
const W = [
  100, -25, 10, 5, 5, 10, -25, 100,
  -25, -45, -2, -2, -2, -2, -45, -25,
  10, -2, 2, 1, 1, 2, -2, 10,
  5, -2, 1, 0, 0, 1, -2, 5,
  5, -2, 1, 0, 0, 1, -2, 5,
  10, -2, 2, 1, 1, 2, -2, 10,
  -25, -45, -2, -2, -2, -2, -45, -25,
  100, -25, 10, 5, 5, 10, -25, 100,
];
// 角と、その角が埋まったら怖くなくなるマス
const CORNERS = [
  [0, [1, 8, 9]],
  [7, [6, 15, 14]],
  [56, [57, 48, 49]],
  [63, [62, 55, 54]],
];

function evaluate(b, p) {
  const o = 3 - p;
  let pos = 0;
  for (let i = 0; i < 64; i++) {
    if (b[i] === p) pos += W[i];
    else if (b[i] === o) pos -= W[i];
  }
  // 角が埋まっていれば、隣のマスの減点を取り消す
  for (const [c, near] of CORNERS) {
    if (b[c] === EMPTY) continue;
    for (const j of near) {
      if (b[j] === p) pos -= W[j] - 3;
      else if (b[j] === o) pos += W[j] - 3;
    }
  }
  const mob = countMoves(b, p) - countMoves(b, o);
  const { omote, ura, empty } = count(b);
  const discs = p === 1 ? omote - ura : ura - omote;
  return pos + mob * 8 + (empty <= 14 ? discs * 3 : 0);
}

function finalScore(b, p) {
  const { omote, ura } = count(b);
  const d = p === 1 ? omote - ura : ura - omote;
  return d * 1000;
}

function order(moves) {
  return moves.sort((a, b) => W[b] - W[a]);
}

function negamax(b, p, depth, alpha, beta, passed, exact) {
  if (depth === 0) return exact ? finalScore(b, p) : evaluate(b, p);
  const moves = legalMoves(b, p);
  if (!moves.length) {
    if (passed) return finalScore(b, p);
    return -negamax(b, 3 - p, depth, -beta, -alpha, true, exact);
  }
  order(moves);
  let best = -Infinity;
  for (const m of moves) {
    const f = flipsOf(b, m, p);
    b[m] = p;
    for (const j of f) b[j] = p;
    const v = -negamax(b, 3 - p, depth - 1, -beta, -alpha, false, exact);
    b[m] = EMPTY;
    for (const j of f) b[j] = 3 - p;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

/** つよい: 位置の重み＋着手可能数で alpha-beta。残り 10 マス以下は最後まで読み切る */
export function chooseStrong(board, p, depth = 4) {
  const b = Int8Array.from(board);
  const moves = order(legalMoves(b, p));
  if (moves.length <= 1) return moves[0] ?? -1;
  const empty = count(b).empty;
  const exact = empty <= 10;
  const d = exact ? empty : depth;
  let best = -1;
  let bestV = -Infinity;
  let alpha = -Infinity;
  for (const m of moves) {
    const f = flipsOf(b, m, p);
    b[m] = p;
    for (const j of f) b[j] = p;
    // 同点の手はすこしだけ揺らす
    const v = -negamax(b, 3 - p, d - 1, -Infinity, -alpha, false, exact) + Math.random() * 0.5;
    b[m] = EMPTY;
    for (const j of f) b[j] = 3 - p;
    if (v > bestV) {
      bestV = v;
      best = m;
    }
    if (v > alpha) alpha = v;
  }
  return best;
}

/** よわい: たくさん返せる手が好き。ときどき気まぐれ */
export function chooseWeak(board, p, rnd = Math.random) {
  const moves = legalMoves(board, p);
  if (!moves.length) return -1;
  if (rnd() < 0.3) return moves[Math.floor(rnd() * moves.length)];
  let best = moves[0];
  let bestV = -Infinity;
  for (const m of moves) {
    const v = flipsOf(board, m, p).length + rnd() * 3;
    if (v > bestV) {
      bestV = v;
      best = m;
    }
  }
  return best;
}

// ワーカーとして読み込まれたとき
if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  self.onmessage = (e) => {
    const { id, board, p, depth } = e.data;
    self.postMessage({ id, move: chooseStrong(board, p, depth) });
  };
}

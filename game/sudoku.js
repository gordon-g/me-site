/* ============================================================
   数独引擎 · 生成 / 求解 / 逻辑推理
   - 生成保证唯一解，并按「解出它所需的最难技巧」定级
   - 推理器供引导模式使用，可解释每一步：唯一候选、隐性唯一、
     数对、区块排除、X-Wing
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sudoku = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const N = 81;
  const ROW = new Uint8Array(N);
  const COL = new Uint8Array(N);
  const BOX = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    ROW[i] = (i / 9) | 0;
    COL[i] = i % 9;
    BOX[i] = (((i / 9) | 0) / 3 | 0) * 3 + ((i % 9) / 3 | 0);
  }

  const PEERS = [];
  for (let i = 0; i < N; i++) {
    const s = new Set();
    for (const j of allCells()) {
      if (j !== i && (ROW[j] === ROW[i] || COL[j] === COL[i] || BOX[j] === BOX[i])) s.add(j);
    }
    PEERS.push(Array.from(s));
  }

  function allCells() {
    const a = [];
    for (let i = 0; i < N; i++) a.push(i);
    return a;
  }

  // 27 个单元：0-8 行 / 9-17 列 / 18-26 宫
  const UNITS = [];
  for (let r = 0; r < 9; r++) UNITS.push(allCells().filter((i) => ROW[i] === r));
  for (let c = 0; c < 9; c++) UNITS.push(allCells().filter((i) => COL[i] === c));
  for (let b = 0; b < 9; b++) UNITS.push(allCells().filter((i) => BOX[i] === b));

  const UNIT_OF = [
    Array.from({ length: N }, (_, i) => ROW[i]),
    Array.from({ length: N }, (_, i) => 9 + COL[i]),
    Array.from({ length: N }, (_, i) => 18 + BOX[i])
  ];

  // ---------- 工具 ----------
  function shuffle(a, rnd) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function popcount(x) {
    let c = 0;
    while (x) { x &= x - 1; c++; }
    return c;
  }

  function bits(mask) {
    const out = [];
    for (let v = 1; v <= 9; v++) if (mask & (1 << (v - 1))) out.push(v);
    return out;
  }

  function bit(v) { return 1 << (v - 1); }

  function isValidPlacement(board, idx, val) {
    for (const p of PEERS[idx]) if (board[p] === val) return false;
    return true;
  }

  function isComplete(board) {
    for (let i = 0; i < N; i++) if (!board[i]) return false;
    return true;
  }

  function conflicts(board) {
    const bad = new Set();
    for (let i = 0; i < N; i++) {
      if (!board[i]) continue;
      for (const p of PEERS[i]) if (board[p] === board[i]) { bad.add(i); bad.add(p); }
    }
    return bad;
  }

  function candidates(board) {
    const cand = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      if (board[i]) { cand[i] = 0; continue; }
      let mask = 0;
      for (const p of PEERS[i]) if (board[p]) mask |= bit(board[p]);
      cand[i] = ~mask & 0x1FF;
    }
    return cand;
  }

  // ---------- 生成完整解 ----------
  function fillBoard(board, rnd) {
    let best = -1, bestCand = null;
    for (let i = 0; i < N; i++) {
      if (board[i]) continue;
      const c = candidates(board)[i];
      const cand = bits(c);
      if (cand.length === 0) return false;
      if (!bestCand || cand.length < bestCand.length) { best = i; bestCand = cand; if (cand.length === 1) break; }
    }
    if (best === -1) return true;
    shuffle(bestCand, rnd);
    for (const v of bestCand) {
      board[best] = v;
      if (fillBoard(board, rnd)) return true;
      board[best] = 0;
    }
    return false;
  }

  function generateSolved(seed) {
    const rnd = mulberry32(seed === undefined ? (Math.random() * 2 ** 31) | 0 : seed);
    const b = new Uint8Array(N);
    fillBoard(b, rnd);
    return b;
  }

  // ---------- 解计数 ----------
  function countSolutions(board, limit, budget) {
    limit = limit || 2;
    let count = 0, nodes = 0;
    const maxNodes = budget || 100000;

    function rec() {
      if (count >= limit || nodes > maxNodes) return;
      nodes++;
      let best = -1, bestCand = null;
      for (let i = 0; i < N; i++) {
        if (board[i]) continue;
        let mask = 0;
        for (const p of PEERS[i]) if (board[p]) mask |= bit(board[p]);
        const cand = bits(~mask & 0x1FF);
        if (cand.length === 0) return;
        if (!bestCand || cand.length < bestCand.length) { best = i; bestCand = cand; if (cand.length === 1) break; }
      }
      if (best === -1) { count++; return; }
      for (const v of bestCand) {
        board[best] = v;
        rec();
        board[best] = 0;
        if (count >= limit) return;
      }
    }
    rec();
    return count;
  }

  function solve(board) {
    const b = Uint8Array.from(board);
    if (countSolutions(b, 1) !== 1) return null;
    return b;
  }

  // ---------- 逻辑求解器 ----------
  const TECH = {
    nakedSingle: 1,
    hiddenSingle: 2,
    nakedPair: 3,
    hiddenPair: 3,
    pointing: 4,
    claiming: 4,
    xwing: 5
  };

  const TECH_LABEL = {
    nakedSingle: '唯一候选',
    hiddenSingle: '隐性唯一',
    nakedPair: '数对排除',
    hiddenPair: '隐性数对',
    pointing: '区块排除',
    claiming: '区块排除',
    xwing: 'X-Wing'
  };

  const ORD = '一二三四五六七八九';
  const UNIT_KIND = ['行', '列', '宫'];

  function cellName(i) { return '第 ' + (ROW[i] + 1) + ' 行第 ' + (COL[i] + 1) + ' 列'; }

  function unitName(u) {
    if (u < 9) return '第 ' + (u + 1) + ' 行';
    if (u < 18) return '第 ' + (u - 8) + ' 列';
    return '第 ' + (u - 17) + ' 宫';
  }

  function unitKind(u) { return u < 9 ? 0 : u < 18 ? 1 : 2; }

  /**
   * LogicSolver：维护棋盘 + 候选数状态，按技巧顺序推进
   */
  function LogicSolver(board) {
    this.grid = Uint8Array.from(board);
    this.cand = candidates(this.grid);
    this.maxTech = 0;
  }

  LogicSolver.prototype.place = function (idx, val) {
    this.grid[idx] = val;
    this.cand[idx] = 0;
    for (const p of PEERS[idx]) if (this.cand[p] & bit(val)) this.cand[p] &= ~bit(val);
  };

  LogicSolver.prototype.eliminate = function (idx, val) {
    if (this.grid[idx]) return false;
    if (!(this.cand[idx] & bit(val))) return false;
    this.cand[idx] &= ~bit(val);
    return true;
  };

  LogicSolver.prototype.note = function (tech) {
    if (TECH[tech] > this.maxTech) this.maxTech = TECH[tech];
  };

  // 返回 null 或一个 step
  LogicSolver.prototype.step = function () {
    return this.nakedSingle() || this.hiddenSingle() || this.nakedSubset(2) ||
      this.hiddenSubset(2) || this.hiddenSubset(3) || this.pointing() ||
      this.claiming() || this.xwing();
  };

  LogicSolver.prototype.nakedSingle = function () {
    for (let i = 0; i < N; i++) {
      if (this.grid[i]) continue;
      const c = this.cand[i];
      if (c && popcount(c) === 1) {
        const v = bits(c)[0];
        return {
          tech: 'nakedSingle', idx: i, value: v,
          title: TECH_LABEL.nakedSingle,
          text: cellName(i) + ' 只剩 ' + v + ' 一个候选数——同行、同列、同宫已经占掉了其余 8 个数字。',
          cells: [i], peers: PEERS[i].slice()
        };
      }
    }
    return null;
  };

  LogicSolver.prototype.hiddenSingle = function () {
    for (let u = 0; u < 27; u++) {
      const unit = UNITS[u];
      const kind = unitKind(u);
      for (let v = 1; v <= 9; v++) {
        if (unit.some((i) => this.grid[i] === v)) continue;
        const spots = unit.filter((i) => !this.grid[i] && (this.cand[i] & bit(v)));
        if (spots.length === 1) {
          const i = spots[0];
          const where = kind === 0 ? '行' : kind === 1 ? '列' : '宫';
          return {
            tech: 'hiddenSingle', idx: i, value: v, unit: u,
            title: TECH_LABEL.hiddenSingle,
            text: '整' + (kind === 2 ? '个' : '一') + where + '里，数字 ' + v + ' 只有一个位置能放：' + cellName(i) +
                  '。其它空格的候选里都没有 ' + v + ' 了。',
            cells: unit.slice(), unit: u
          };
        }
      }
    }
    return null;
  };

  // Naked Pair / Triple：单元里 n 格的候选并集正好 n 个数
  LogicSolver.prototype.nakedSubset = function (n) {
    for (let u = 0; u < 27; u++) {
      const unit = UNITS[u].filter((i) => !this.grid[i]);
      const pool = unit.filter((i) => {
        const c = popcount(this.cand[i]);
        return c >= 2 && c <= n;
      });
      const combos = combinations(pool, n);
      for (const combo of combos) {
        let union = 0;
        for (const i of combo) union |= this.cand[i];
        if (popcount(union) !== n) continue;
        const targets = [];
        for (const i of unit) {
          if (combo.includes(i)) continue;
          for (const v of bits(union)) if (this.cand[i] & bit(v)) targets.push({ idx: i, value: v });
        }
        if (!targets.length) continue;
        const vals = bits(union).join('、');
        return {
          tech: n === 2 ? 'nakedPair' : 'nakedPair', idx: -1, value: 0, unit: u,
          title: n === 2 ? TECH_LABEL.nakedPair : '数组排除',
          text: unitName(u) + '里的 ' + combo.map(cellName).join('、') + ' 只能填 ' + vals +
                ' 这几个数，所以这一' + UNIT_KIND[unitKind(u)] + '的其它格子都不能填 ' + vals + '。',
          cells: combo.concat(targets.map((t) => t.idx)),
          unit: u,
          eliminations: targets
        };
      }
    }
    return null;
  };

  LogicSolver.prototype.hiddenSubset = function (n) {
    for (let u = 0; u < 27; u++) {
      const unit = UNITS[u].filter((i) => !this.grid[i]);
      const spotOf = {};
      for (let v = 1; v <= 9; v++) {
        const spots = unit.filter((i) => this.cand[i] & bit(v));
        if (spots.length >= 2 && spots.length <= n) spotOf[v] = spots;
      }
      const vals = Object.keys(spotOf).map(Number);
      for (const combo of combinations(vals, n)) {
        const set = new Set();
        for (const v of combo) spotOf[v].forEach((i) => set.add(i));
        if (set.size !== n) continue;
        const cells = Array.from(set);
        const keep = combo.reduce((m, v) => m | bit(v), 0);
        const eliminations = [];
        for (const i of cells) {
          for (const v of bits(this.cand[i])) {
            if (!(keep & bit(v))) eliminations.push({ idx: i, value: v });
          }
        }
        if (!eliminations.length) continue;
        return {
          tech: 'hiddenPair', idx: -1, value: 0, unit: u,
          title: n === 2 ? TECH_LABEL.hiddenPair : '隐性数组',
          text: unitName(u) + '里，数字 ' + combo.join('、') + ' 只可能出现在 ' +
                cells.map(cellName).join('、') + ' 这几格，所以这些格子里其它候选数都可以划掉。',
          cells, unit: u, eliminations
        };
      }
    }
    return null;
  };

  LogicSolver.prototype.pointing = function () {
    for (let b = 0; b < 9; b++) {
      const box = UNITS[18 + b];
      for (let v = 1; v <= 9; v++) {
        if (box.some((i) => this.grid[i] === v)) continue;
        const spots = box.filter((i) => !this.grid[i] && (this.cand[i] & bit(v)));
        if (spots.length < 2 || spots.length > 3) continue;
        if (new Set(spots.map((i) => ROW[i])).size === 1) {
          const r = ROW[spots[0]];
          const targets = UNITS[r].filter((i) => !spots.includes(i) && !this.grid[i] && (this.cand[i] & bit(v)))
            .map((i) => ({ idx: i, value: v }));
          if (targets.length) {
            return {
              tech: 'pointing', idx: -1, value: 0, unit: 18 + b,
              title: TECH_LABEL.pointing,
              text: '第 ' + (b + 1) + ' 宫里，数字 ' + v + ' 只能落在第 ' + (r + 1) + ' 行，所以这一行其它格子都能划掉 ' + v + '。',
              cells: spots.concat(targets.map((t) => t.idx)), unit: 18 + b, eliminations: targets
            };
          }
        }
        if (new Set(spots.map((i) => COL[i])).size === 1) {
          const c = COL[spots[0]];
          const targets = UNITS[9 + c].filter((i) => !spots.includes(i) && !this.grid[i] && (this.cand[i] & bit(v)))
            .map((i) => ({ idx: i, value: v }));
          if (targets.length) {
            return {
              tech: 'pointing', idx: -1, value: 0, unit: 18 + b,
              title: TECH_LABEL.pointing,
              text: '第 ' + (b + 1) + ' 宫里，数字 ' + v + ' 只能落在第 ' + (c + 1) + ' 列，所以这一列其它格子都能划掉 ' + v + '。',
              cells: spots.concat(targets.map((t) => t.idx)), unit: 18 + b, eliminations: targets
            };
          }
        }
      }
    }
    return null;
  };

  LogicSolver.prototype.claiming = function () {
    for (let k = 0; k < 18; k++) {
      const unit = UNITS[k];
      for (let v = 1; v <= 9; v++) {
        if (unit.some((i) => this.grid[i] === v)) continue;
        const spots = unit.filter((i) => !this.grid[i] && (this.cand[i] & bit(v)));
        if (spots.length < 2 || spots.length > 3) continue;
        if (new Set(spots.map((i) => BOX[i])).size !== 1) continue;
        const b = BOX[spots[0]];
        const targets = UNITS[18 + b].filter((i) => !spots.includes(i) && !this.grid[i] && (this.cand[i] & bit(v)))
          .map((i) => ({ idx: i, value: v }));
        if (targets.length) {
          const kind = k < 9 ? '第 ' + (k + 1) + ' 行' : '第 ' + (k - 8) + ' 列';
          return {
            tech: 'claiming', idx: -1, value: 0, unit: k,
            title: TECH_LABEL.claiming,
            text: kind + '里，数字 ' + v + ' 只能落在第 ' + (b + 1) + ' 宫，所以这一宫其它格子都可以划掉 ' + v + '。',
            cells: spots.concat(targets.map((t) => t.idx)), unit: k, eliminations: targets
          };
        }
      }
    }
    return null;
  };

  LogicSolver.prototype.xwing = function () {
    for (let v = 1; v <= 9; v++) {
      // 以行找列
      const rows = [];
      for (let r = 0; r < 9; r++) {
        const spots = UNITS[r].filter((i) => !this.grid[i] && (this.cand[i] & bit(v)));
        if (spots.length === 2) rows.push({ r, cols: spots.map((i) => COL[i]) });
      }
      for (let a = 0; a < rows.length; a++) {
        for (let b = a + 1; b < rows.length; b++) {
          if (rows[a].cols[0] !== rows[b].cols[0] || rows[a].cols[1] !== rows[b].cols[1]) continue;
          const cols = rows[a].cols;
          const targets = [];
          for (const c of cols) {
            for (let r = 0; r < 9; r++) {
              const i = r * 9 + c;
              if (r === rows[a].r || r === rows[b].r) continue;
              if (!this.grid[i] && (this.cand[i] & bit(v))) targets.push({ idx: i, value: v });
            }
          }
          if (!targets.length) continue;
          return {
            tech: 'xwing', idx: -1, value: 0,
            title: TECH_LABEL.xwing,
            text: '第 ' + (rows[a].r + 1) + ' 行和第 ' + (rows[b].r + 1) + ' 行里，数字 ' + v +
                  ' 都只可能落在第 ' + (cols[0] + 1) + ' 列和第 ' + (cols[1] + 1) +
                  ' 列。这样这两列其它位置的 ' + v + ' 就可以划掉了。',
            cells: [rows[a].r * 9 + cols[0], rows[a].r * 9 + cols[1], rows[b].r * 9 + cols[0], rows[b].r * 9 + cols[1]]
              .concat(targets.map((t) => t.idx)),
            eliminations: targets
          };
        }
      }
      // 以列找行
      const cols = [];
      for (let c = 0; c < 9; c++) {
        const spots = UNITS[9 + c].filter((i) => !this.grid[i] && (this.cand[i] & bit(v)));
        if (spots.length === 2) cols.push({ c, rows: spots.map((i) => ROW[i]) });
      }
      for (let a = 0; a < cols.length; a++) {
        for (let b = a + 1; b < cols.length; b++) {
          if (cols[a].rows[0] !== cols[b].rows[0] || cols[a].rows[1] !== cols[b].rows[1]) continue;
          const rs = cols[a].rows;
          const targets = [];
          for (const r of rs) {
            for (let c = 0; c < 9; c++) {
              const i = r * 9 + c;
              if (c === cols[a].c || c === cols[b].c) continue;
              if (!this.grid[i] && (this.cand[i] & bit(v))) targets.push({ idx: i, value: v });
            }
          }
          if (!targets.length) continue;
          return {
            tech: 'xwing', idx: -1, value: 0,
            title: TECH_LABEL.xwing,
            text: '第 ' + (cols[a].c + 1) + ' 列和第 ' + (cols[b].c + 1) + ' 列里，数字 ' + v +
                  ' 都只可能落在第 ' + (rs[0] + 1) + ' 行和第 ' + (rs[1] + 1) + ' 行。这样这两行其它位置的 ' + v + ' 就可以划掉了。',
            cells: [rs[0] * 9 + cols[a].c, rs[1] * 9 + cols[a].c, rs[0] * 9 + cols[b].c, rs[1] * 9 + cols[b].c]
              .concat(targets.map((t) => t.idx)),
            eliminations: targets
          };
        }
      }
    }
    return null;
  };

  // 应用一步
  LogicSolver.prototype.apply = function (step) {
    if (step.value && step.idx >= 0) {
      this.place(step.idx, step.value);
    } else if (step.eliminations) {
      let changed = false;
      for (const e of step.eliminations) if (this.eliminate(e.idx, e.value)) changed = true;
      if (!changed) return false;
    }
    this.note(step.tech);
    return true;
  };

  /** 完全用逻辑解完，返回 {solved, maxTech, stuck} */
  LogicSolver.prototype.solveAll = function (maxSteps) {
    let steps = 0;
    const limit = maxSteps || 400;
    while (!isComplete(this.grid) && steps < limit) {
      const s = this.step();
      if (!s) break;
      if (!this.apply(s)) { /* 该技巧没有实际收益，跳到下一种 */ }
      steps++;
    }
    return { solved: isComplete(this.grid), maxTech: this.maxTech, steps };
  };

  function combinations(arr, k) {
    const out = [];
    if (k > arr.length) return out;
    const idx = [];
    (function rec(start, depth) {
      if (depth === k) { out.push(idx.map((i) => arr[i])); return; }
      for (let i = start; i < arr.length; i++) { idx[depth] = i; rec(i + 1, depth + 1); }
    })(0, 0);
    return out;
  }

  // ---------- 难度配置 ----------
  const LEVELS = {
    easy:   { clues: 42, label: '入门', symmetric: true,  grade: [1, 1] },
    medium: { clues: 34, label: '进阶', symmetric: true,  grade: [2, 2] },
    hard:   { clues: 29, label: '困难', symmetric: true,  grade: [3, 4] },
    expert: { clues: 25, label: '专家', symmetric: false, grade: [4, 5] }
  };

  function assess(puzzle) {
    const s = new LogicSolver(puzzle);
    const r = s.solveAll();
    return r;
  }

  function dig(solution, cfg, rnd) {
    const puzzle = Uint8Array.from(solution);
    let clues = N;

    const order = shuffle(Array.from({ length: 41 }, (_, i) => i), rnd);
    for (const i of order) {
      if (clues <= cfg.clues) break;
      const j = 80 - i;
      const pair = i === j ? [i] : (cfg.symmetric ? [i, j] : [i]);
      if (clues - pair.length < cfg.clues) continue;
      const saved = pair.map((p) => puzzle[p]);
      pair.forEach((p) => { puzzle[p] = 0; });
      if (countSolutions(Uint8Array.from(puzzle), 2, 40000) !== 1) {
        pair.forEach((p, k) => { puzzle[p] = saved[k]; });
      } else {
        clues -= pair.length;
      }
    }

    if (clues > cfg.clues) {
      const cells = shuffle(allCells(), rnd);
      for (const i of cells) {
        if (clues <= cfg.clues) break;
        if (!puzzle[i]) continue;
        const v = puzzle[i];
        puzzle[i] = 0;
        if (countSolutions(Uint8Array.from(puzzle), 2, 40000) !== 1) puzzle[i] = v;
        else clues--;
      }
    }
    return { puzzle, clues };
  }

  /**
   * 生成一局；会按目标技巧等级筛选，最多重试若干次
   * 返回 { puzzle, solution, level, clues, maxTech }
   */
  function generate(level, seed) {
    const cfg = LEVELS[level] || LEVELS.medium;
    const rnd = mulberry32(seed === undefined ? (Math.random() * 2 ** 31) | 0 : seed);
    let best = null;
    const attempts = 14;

    for (let a = 0; a < attempts; a++) {
      const solution = generateSolved((rnd() * 2 ** 31) | 0);
      const { puzzle, clues } = dig(solution, cfg, rnd);
      const r = assess(puzzle);
      const candidate = { puzzle, solution, level, clues, maxTech: r.maxTech, logicSolved: r.solved };
      if (r.solved && r.maxTech >= cfg.grade[0] && r.maxTech <= cfg.grade[1]) {
        return candidate;
      }
      if (!best || Math.abs(r.maxTech - cfg.grade[0]) < Math.abs(best.maxTech - cfg.grade[0])) best = candidate;
    }
    return best;
  }

  function findStep(board) {
    return new LogicSolver(board).step();
  }

  return {
    N, ROW, COL, BOX, PEERS, UNITS, UNIT_OF, LEVELS, TECH_LABEL,
    generate, generateSolved, countSolutions, solve, assess, LogicSolver,
    candidates, bits, popcount, findStep, cellName, unitName, unitKind,
    conflicts, isComplete, mulberry32, shuffle, isValidPlacement
  };
});

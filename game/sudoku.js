/* ============================================================
   数独引擎 · 生成 / 求解 / 逻辑推理
   - 支持 3×3 / 4×4 / 6×6 / 9×9（宫 = 1×3 / 2×2 / 2×3 / 3×3）
   - 生成保证唯一解，并按「解出它所需的最难技巧」定级
   - 推理器供引导模式使用，可解释每一步：唯一候选、隐性唯一、
     数对、区块排除、X-Wing
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sudoku = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIZES = [3, 4, 6, 9];
  // [宫高, 宫宽]
  const BOX_LAYOUT = { 3: [1, 3], 4: [2, 2], 6: [2, 3], 9: [3, 3] };

  // 提示数占比（按棋盘总格数）
  const RATIO = { easy: 0.52, medium: 0.42, hard: 0.36, expert: 0.31 };

  // 各尺寸下「难度」对应的技巧等级区间（技巧难度见 TECH）
  const GRADES = {
    3: { easy: [1, 2], medium: [1, 2], hard: [1, 2], expert: [1, 2] },
    4: { easy: [1, 2], medium: [1, 2], hard: [2, 2], expert: [2, 3] },
    6: { easy: [1, 1], medium: [2, 2], hard: [2, 3], expert: [3, 4] },
    9: { easy: [1, 1], medium: [2, 2], hard: [3, 4], expert: [4, 5] }
  };

  // ---------- 几何（随棋盘尺寸重建） ----------
  let SIZE = 9, BOXH = 3, BOXW = 3, CELLS = 81, FULL = 0x1FF;
  let ROW = null, COL = null, BOX = null, PEERS = null, UNITS = null, LEVELS = null;

  const API = {};

  function cellsIn(pred) {
    const out = [];
    for (let i = 0; i < CELLS; i++) if (pred(i)) out.push(i);
    return out;
  }

  function buildLevels() {
    const g = GRADES[SIZE] || GRADES[9];
    const mk = (key, label, symmetric, grade) => ({
      clues: Math.max(2, Math.min(CELLS - 2, Math.round(CELLS * RATIO[key]))),
      label, symmetric, grade
    });
    LEVELS = {
      easy:   mk('easy', '入门', true,  g.easy),
      medium: mk('medium', '进阶', true,  g.medium),
      hard:   mk('hard', '困难', true,  g.hard),
      expert: mk('expert', '专家', false, g.expert)
    };
  }

  function setSize(n) {
    n = SIZES.indexOf(n) >= 0 ? n : 9;
    if (PEERS && n === SIZE) return API;
    SIZE = n;
    const lay = BOX_LAYOUT[n];
    BOXH = lay[0];
    BOXW = lay[1];
    CELLS = n * n;
    FULL = (1 << n) - 1;

    ROW = new Uint8Array(CELLS);
    COL = new Uint8Array(CELLS);
    BOX = new Uint8Array(CELLS);
    for (let i = 0; i < CELLS; i++) {
      const r = (i / n) | 0;
      const c = i % n;
      ROW[i] = r;
      COL[i] = c;
      BOX[i] = ((r / BOXH) | 0) * (n / BOXW) + ((c / BOXW) | 0);
    }

    PEERS = [];
    for (let i = 0; i < CELLS; i++) {
      const s = [];
      for (let j = 0; j < CELLS; j++) {
        if (j !== i && (ROW[j] === ROW[i] || COL[j] === COL[i] || BOX[j] === BOX[i])) s.push(j);
      }
      PEERS.push(s);
    }

    // 3n 个单元：0..n-1 行 / n..2n-1 列 / 2n..3n-1 宫
    UNITS = [];
    for (let r = 0; r < n; r++) UNITS.push(cellsIn((i) => ROW[i] === r));
    for (let c = 0; c < n; c++) UNITS.push(cellsIn((i) => COL[i] === c));
    for (let b = 0; b < n; b++) UNITS.push(cellsIn((i) => BOX[i] === b));

    buildLevels();

    API.N = CELLS;
    API.SIZE = n;
    API.CELLS = CELLS;
    API.BOXH = BOXH;
    API.BOXW = BOXW;
    API.ROW = ROW;
    API.COL = COL;
    API.BOX = BOX;
    API.PEERS = PEERS;
    API.UNITS = UNITS;
    API.LEVELS = LEVELS;
    return API;
  }

  function unitOfRow(r) { return r; }
  function unitOfCol(c) { return SIZE + c; }
  function unitOfBox(b) { return 2 * SIZE + b; }

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
    for (let v = 1; v <= SIZE; v++) if (mask & (1 << (v - 1))) out.push(v);
    return out;
  }

  function bit(v) { return 1 << (v - 1); }

  function isValidPlacement(board, idx, val) {
    for (const p of PEERS[idx]) if (board[p] === val) return false;
    return true;
  }

  function isComplete(board) {
    for (let i = 0; i < CELLS; i++) if (!board[i]) return false;
    return true;
  }

  function conflicts(board) {
    const bad = new Set();
    for (let i = 0; i < CELLS; i++) {
      if (!board[i]) continue;
      for (const p of PEERS[i]) if (board[p] === board[i]) { bad.add(i); bad.add(p); }
    }
    return bad;
  }

  function candidates(board) {
    const cand = new Int32Array(CELLS);
    for (let i = 0; i < CELLS; i++) {
      if (board[i]) { cand[i] = 0; continue; }
      let mask = 0;
      for (const p of PEERS[i]) if (board[p]) mask |= bit(board[p]);
      cand[i] = ~mask & FULL;
    }
    return cand;
  }

  // ---------- 生成完整解 ----------
  function fillBoard(board, rnd) {
    let best = -1, bestCand = null;
    const cand = candidates(board);
    for (let i = 0; i < CELLS; i++) {
      if (board[i]) continue;
      const c = cand[i];
      if (!c) return false;
      const cnt = popcount(c);
      if (!bestCand || cnt < bestCand.length) {
        best = i;
        bestCand = bits(c);
        if (cnt === 1) break;
      }
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
    const b = new Uint8Array(CELLS);
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
      for (let i = 0; i < CELLS; i++) {
        if (board[i]) continue;
        let mask = 0;
        for (const p of PEERS[i]) if (board[p]) mask |= bit(board[p]);
        const cand = bits(~mask & FULL);
        if (!cand.length) return;
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

  const UNIT_KIND = ['行', '列', '宫'];

  function cellName(i) { return '第 ' + (ROW[i] + 1) + ' 行第 ' + (COL[i] + 1) + ' 列'; }

  function unitKind(u) { return u < SIZE ? 0 : u < 2 * SIZE ? 1 : 2; }

  function unitName(u) {
    const k = unitKind(u);
    if (k === 0) return '第 ' + (u + 1) + ' 行';
    if (k === 1) return '第 ' + (u - SIZE + 1) + ' 列';
    return '第 ' + (u - 2 * SIZE + 1) + ' 宫';
  }

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
    return this.nakedSingle() || this.hiddenSingle() ||
      this.nakedSubset(2) || this.hiddenSubset(2) ||
      (SIZE >= 4 ? this.nakedSubset(3) : null) ||
      (SIZE >= 4 ? this.hiddenSubset(3) : null) ||
      (SIZE >= 4 ? this.pointing() : null) ||
      (SIZE >= 4 ? this.claiming() : null) ||
      (SIZE >= 6 ? this.xwing() : null);
  };

  LogicSolver.prototype.nakedSingle = function () {
    for (let i = 0; i < CELLS; i++) {
      if (this.grid[i]) continue;
      const c = this.cand[i];
      if (c && popcount(c) === 1) {
        const v = bits(c)[0];
        return {
          tech: 'nakedSingle', idx: i, value: v,
          title: TECH_LABEL.nakedSingle,
          text: cellName(i) + ' 只剩 ' + v + ' 一个候选数——同行、同列、同宫已经占掉了其余 ' + (SIZE - 1) + ' 个数字。',
          cells: [i], peers: PEERS[i].slice()
        };
      }
    }
    return null;
  };

  LogicSolver.prototype.hiddenSingle = function () {
    const total = 3 * SIZE;
    for (let u = 0; u < total; u++) {
      const unit = UNITS[u];
      const kind = unitKind(u);
      for (let v = 1; v <= SIZE; v++) {
        let found = false;
        for (const i of unit) if (this.grid[i] === v) { found = true; break; }
        if (found) continue;
        let spot = -1, n = 0;
        for (const i of unit) {
          if (!this.grid[i] && (this.cand[i] & bit(v))) { spot = i; n++; if (n > 1) break; }
        }
        if (n === 1) {
          const where = UNIT_KIND[kind];
          return {
            tech: 'hiddenSingle', idx: spot, value: v, unit: u,
            title: TECH_LABEL.hiddenSingle,
            text: '整' + (kind === 2 ? '个' : '一') + where + '里，数字 ' + v + ' 只有一个位置能放：' + cellName(spot) +
                  '。其它空格的候选里都没有 ' + v + ' 了。',
            cells: unit.slice()
          };
        }
      }
    }
    return null;
  };

  // Naked Pair / Triple：单元里 n 格的候选并集正好 n 个数
  LogicSolver.prototype.nakedSubset = function (n) {
    if (n > SIZE - 1) return null;
    const total = 3 * SIZE;
    for (let u = 0; u < total; u++) {
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
          if (combo.indexOf(i) >= 0) continue;
          for (const v of bits(union)) if (this.cand[i] & bit(v)) targets.push({ idx: i, value: v });
        }
        if (!targets.length) continue;
        const vals = bits(union).join('、');
        return {
          tech: 'nakedPair', idx: -1, value: 0, unit: u,
          title: n === 2 ? TECH_LABEL.nakedPair : '数组排除',
          text: unitName(u) + '里的 ' + combo.map(cellName).join('、') + ' 只能填 ' + vals +
                ' 这几个数，所以这一' + UNIT_KIND[unitKind(u)] + '的其它格子都不能填 ' + vals + '。',
          cells: combo.concat(targets.map((t) => t.idx)),
          eliminations: targets
        };
      }
    }
    return null;
  };

  LogicSolver.prototype.hiddenSubset = function (n) {
    if (n > SIZE - 1) return null;
    const total = 3 * SIZE;
    for (let u = 0; u < total; u++) {
      const unit = UNITS[u].filter((i) => !this.grid[i]);
      const spotOf = {};
      const vals = [];
      for (let v = 1; v <= SIZE; v++) {
        const spots = unit.filter((i) => this.cand[i] & bit(v));
        if (spots.length >= 2 && spots.length <= n) { spotOf[v] = spots; vals.push(v); }
      }
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
          cells, eliminations
        };
      }
    }
    return null;
  };

  LogicSolver.prototype.pointing = function () {
    for (let b = 0; b < SIZE; b++) {
      const box = UNITS[unitOfBox(b)];
      for (let v = 1; v <= SIZE; v++) {
        let found = false;
        for (const i of box) if (this.grid[i] === v) { found = true; break; }
        if (found) continue;
        const spots = box.filter((i) => !this.grid[i] && (this.cand[i] & bit(v)));
        if (spots.length < 2 || spots.length > Math.min(3, SIZE)) continue;
        const rows = new Set(spots.map((i) => ROW[i]));
        if (rows.size === 1) {
          const r = ROW[spots[0]];
          const targets = UNITS[unitOfRow(r)]
            .filter((i) => spots.indexOf(i) < 0 && !this.grid[i] && (this.cand[i] & bit(v)))
            .map((i) => ({ idx: i, value: v }));
          if (targets.length) {
            return {
              tech: 'pointing', idx: -1, value: 0, unit: unitOfBox(b),
              title: TECH_LABEL.pointing,
              text: '第 ' + (b + 1) + ' 宫里，数字 ' + v + ' 只能落在第 ' + (r + 1) + ' 行，所以这一行其它格子都能划掉 ' + v + '。',
              cells: spots.concat(targets.map((t) => t.idx)), eliminations: targets
            };
          }
        }
        const cols = new Set(spots.map((i) => COL[i]));
        if (cols.size === 1) {
          const c = COL[spots[0]];
          const targets = UNITS[unitOfCol(c)]
            .filter((i) => spots.indexOf(i) < 0 && !this.grid[i] && (this.cand[i] & bit(v)))
            .map((i) => ({ idx: i, value: v }));
          if (targets.length) {
            return {
              tech: 'pointing', idx: -1, value: 0, unit: unitOfBox(b),
              title: TECH_LABEL.pointing,
              text: '第 ' + (b + 1) + ' 宫里，数字 ' + v + ' 只能落在第 ' + (c + 1) + ' 列，所以这一列其它格子都能划掉 ' + v + '。',
              cells: spots.concat(targets.map((t) => t.idx)), eliminations: targets
            };
          }
        }
      }
    }
    return null;
  };

  LogicSolver.prototype.claiming = function () {
    for (let k = 0; k < 2 * SIZE; k++) {
      const unit = UNITS[k];
      for (let v = 1; v <= SIZE; v++) {
        let found = false;
        for (const i of unit) if (this.grid[i] === v) { found = true; break; }
        if (found) continue;
        const spots = unit.filter((i) => !this.grid[i] && (this.cand[i] & bit(v)));
        if (spots.length < 2 || spots.length > Math.min(3, SIZE)) continue;
        if (new Set(spots.map((i) => BOX[i])).size !== 1) continue;
        const b = BOX[spots[0]];
        const targets = UNITS[unitOfBox(b)]
          .filter((i) => spots.indexOf(i) < 0 && !this.grid[i] && (this.cand[i] & bit(v)))
          .map((i) => ({ idx: i, value: v }));
        if (targets.length) {
          const kind = k < SIZE ? '第 ' + (k + 1) + ' 行' : '第 ' + (k - SIZE + 1) + ' 列';
          return {
            tech: 'claiming', idx: -1, value: 0, unit: k,
            title: TECH_LABEL.claiming,
            text: kind + '里，数字 ' + v + ' 只能落在第 ' + (b + 1) + ' 宫，所以这一宫其它格子都可以划掉 ' + v + '。',
            cells: spots.concat(targets.map((t) => t.idx)), eliminations: targets
          };
        }
      }
    }
    return null;
  };

  LogicSolver.prototype.xwing = function () {
    for (let v = 1; v <= SIZE; v++) {
      // 以行找列
      const rows = [];
      for (let r = 0; r < SIZE; r++) {
        const spots = UNITS[unitOfRow(r)].filter((i) => !this.grid[i] && (this.cand[i] & bit(v)));
        if (spots.length === 2) rows.push({ r, cols: spots.map((i) => COL[i]) });
      }
      for (let a = 0; a < rows.length; a++) {
        for (let b = a + 1; b < rows.length; b++) {
          if (rows[a].cols[0] !== rows[b].cols[0] || rows[a].cols[1] !== rows[b].cols[1]) continue;
          const cols = rows[a].cols;
          const targets = [];
          for (const c of cols) {
            for (let r = 0; r < SIZE; r++) {
              if (r === rows[a].r || r === rows[b].r) continue;
              const i = r * SIZE + c;
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
            cells: [rows[a].r * SIZE + cols[0], rows[a].r * SIZE + cols[1],
                    rows[b].r * SIZE + cols[0], rows[b].r * SIZE + cols[1]]
              .concat(targets.map((t) => t.idx)),
            eliminations: targets
          };
        }
      }
      // 以列找行
      const colsPool = [];
      for (let c = 0; c < SIZE; c++) {
        const spots = UNITS[unitOfCol(c)].filter((i) => !this.grid[i] && (this.cand[i] & bit(v)));
        if (spots.length === 2) colsPool.push({ c, rows: spots.map((i) => ROW[i]) });
      }
      for (let a = 0; a < colsPool.length; a++) {
        for (let b = a + 1; b < colsPool.length; b++) {
          if (colsPool[a].rows[0] !== colsPool[b].rows[0] || colsPool[a].rows[1] !== colsPool[b].rows[1]) continue;
          const rs = colsPool[a].rows;
          const targets = [];
          for (const r of rs) {
            for (let c = 0; c < SIZE; c++) {
              if (c === colsPool[a].c || c === colsPool[b].c) continue;
              const i = r * SIZE + c;
              if (!this.grid[i] && (this.cand[i] & bit(v))) targets.push({ idx: i, value: v });
            }
          }
          if (!targets.length) continue;
          return {
            tech: 'xwing', idx: -1, value: 0,
            title: TECH_LABEL.xwing,
            text: '第 ' + (colsPool[a].c + 1) + ' 列和第 ' + (colsPool[b].c + 1) + ' 列里，数字 ' + v +
                  ' 都只可能落在第 ' + (rs[0] + 1) + ' 行和第 ' + (rs[1] + 1) + ' 行。这样这两行其它位置的 ' + v + ' 就可以划掉了。',
            cells: [rs[0] * SIZE + colsPool[a].c, rs[1] * SIZE + colsPool[a].c,
                    rs[0] * SIZE + colsPool[b].c, rs[1] * SIZE + colsPool[b].c]
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

  /** 完全用逻辑解完，返回 {solved, maxTech, steps} */
  LogicSolver.prototype.solveAll = function (maxSteps) {
    let steps = 0;
    const limit = maxSteps || 400;
    let guard = 0;
    while (!isComplete(this.grid) && steps < limit && guard < limit * 2) {
      guard++;
      const s = this.step();
      if (!s) break;
      if (this.apply(s)) steps++;
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

  function assess(puzzle) {
    return new LogicSolver(puzzle).solveAll();
  }

  function dig(solution, cfg, rnd) {
    const puzzle = Uint8Array.from(solution);
    const target = cfg.clues;
    let clues = CELLS;

    const half = Math.ceil(CELLS / 2);
    const order = cfg.symmetric
      ? shuffle(Array.from({ length: half }, (_, i) => i), rnd)
      : shuffle(Array.from({ length: CELLS }, (_, i) => i), rnd);

    for (const i of order) {
      if (clues <= target) break;
      const j = CELLS - 1 - i;
      const pair = (cfg.symmetric && i !== j) ? [i, j] : [i];
      if (clues - pair.length < target) continue;
      const saved = pair.map((p) => puzzle[p]);
      pair.forEach((p) => { puzzle[p] = 0; });
      if (countSolutions(Uint8Array.from(puzzle), 2, 40000) !== 1) {
        pair.forEach((p, k) => { puzzle[p] = saved[k]; });
      } else {
        clues -= pair.length;
      }
    }

    // 对称挖洞没挖够时，再逐格补挖
    if (clues > target) {
      const cells = shuffle(Array.from({ length: CELLS }, (_, i) => i), rnd);
      for (const i of cells) {
        if (clues <= target) break;
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
   * 生成一局；按目标技巧等级筛选，最多重试若干次
   * 返回 { puzzle, solution, level, clues, maxTech, size }
   */
  function generate(level, seed) {
    const cfg = LEVELS[level] || LEVELS.medium;
    const s = LEVELS[level] ? level : 'medium';
    const rnd = mulberry32(seed === undefined ? (Math.random() * 2 ** 31) | 0 : seed);
    let best = null;
    const attempts = SIZE >= 9 ? 14 : 8;

    for (let a = 0; a < attempts; a++) {
      const solution = generateSolved((rnd() * 2 ** 31) | 0);
      const dug = dig(solution, cfg, rnd);
      const r = assess(dug.puzzle);
      const candidate = {
        puzzle: dug.puzzle, solution, level: s, size: SIZE,
        clues: dug.clues, maxTech: r.maxTech, logicSolved: r.solved
      };
      if (r.solved && r.maxTech >= cfg.grade[0] && r.maxTech <= cfg.grade[1]) return candidate;
      // 兜底：优先「纯逻辑可解」，再看技巧等级是否贴近目标
      if (!best) best = candidate;
      else {
        const candBad = candidate.logicSolved ? 0 : 1;
        const bestBad = best.logicSolved ? 0 : 1;
        if (candBad < bestBad ||
            (candBad === bestBad &&
             Math.abs(candidate.maxTech - cfg.grade[0]) < Math.abs(best.maxTech - cfg.grade[0]))) {
          best = candidate;
        }
      }
    }
    return best;
  }

  function findStep(board) {
    return new LogicSolver(board).step();
  }

  setSize(9);

  return Object.assign(API, {
    SIZES, setSize, unitOfRow, unitOfCol, unitOfBox,
    generate, generateSolved, countSolutions, solve, assess, LogicSolver,
    candidates, bits, popcount, findStep, cellName, unitName, unitKind,
    conflicts, isComplete, mulberry32, shuffle, isValidPlacement, TECH
  });
});

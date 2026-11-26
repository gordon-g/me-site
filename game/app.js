/* ============================================================
   数独 · 主程序
   ============================================================ */
(function () {
  'use strict';

  const S = window.Sudoku;
  const Sound = window.Sound;
  const $ = (id) => document.getElementById(id);

  const KEY = 'sudoku54:v1';
  const LEVEL_ORDER = ['easy', 'medium', 'hard', 'expert'];
  const LEVEL_NAME = { easy: '入门', medium: '进阶', hard: '困难', expert: '专家' };
  const DAILY_PLAN = ['medium', 'easy', 'medium', 'hard', 'medium', 'hard', 'expert']; // 周日→周六

  // ---------------- 存储 ----------------
  let store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { store = {}; }
  store.settings = Object.assign({ sound: true, volume: 0.55, coach: true, welcomed: false }, store.settings || {});
  store.best = store.best || {};
  store.daily = store.daily || {};
  store.stats = store.stats || { games: 0, wins: 0, seconds: 0 };

  const settings = store.settings;

  function persist() {
    try {
      const payload = {
        settings,
        best: store.best,
        daily: store.daily,
        stats: store.stats,
        save: serialize()
      };
      localStorage.setItem(KEY, JSON.stringify(payload));
    } catch (e) { /* 隐私模式下忽略 */ }
  }

  // ---------------- 元素 ----------------
  const UI = {
    board: $('board'),
    padNums: $('padNums'),
    modeLabel: $('modeLabel'),
    levelLabel: $('levelLabel'),
    rankChip: $('rankChip'),
    clock: $('clock'),
    statErrors: $('statErrors'),
    statHints: $('statHints'),
    statFilled: $('statFilled'),
    levels: $('levels'),
    daily: $('daily'),
    recordList: $('recordList'),
    coach: $('coach'),
    coachTag: $('coachTag'),
    coachText: $('coachText'),
    coachActions: $('coachActions'),
    modal: $('modal'),
    modalCard: $('modalCard'),
    toast: $('toast'),
    btnSound: $('btnSound'),
    btnGuide: $('btnGuide'),
    btnPause: $('btnPause'),
    btnNew: $('btnNew'),
    btnNote: $('btnNote'),
    btnUndo: $('btnUndo'),
    btnHint: $('btnHint')
  };

  // ---------------- 状态 ----------------
  let st = null;          // 当前局
  let cells = [];         // DOM 引用
  let timerId = null;
  let hintTimer = null;

  function todayKey() {
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  function keyToLabel(k) {
    const s = String(k);
    return s.slice(4, 6) + ' 月 ' + s.slice(6, 8) + ' 日';
  }

  function dailyLevelFor(k) {
    const s = String(k);
    const d = new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
    return DAILY_PLAN[d.getDay()];
  }

  // ---------------- 新局 ----------------
  function newGame(level, opts) {
    opts = opts || {};
    const mode = opts.mode || 'practice';
    const dateKey = mode === 'daily' ? todayKey() : null;
    const seed = mode === 'daily' ? Number(String(dateKey)) : opts.seed;

    setLoading(true);
    // 让“生成中”先绘制出来
    setTimeout(() => {
      const g = S.generate(level, seed);
      st = {
        level, mode, dateKey, seed,
        puzzle: Uint8Array.from(g.puzzle),
        solution: Uint8Array.from(g.solution),
        grid: Uint8Array.from(g.puzzle),
        notes: Array.from({ length: 81 }, () => new Set()),
        selected: -1,
        noteMode: false,
        errors: 0,
        hints: 0,
        wrong: new Set(),
        history: [],
        accumulated: 0,
        runFrom: Date.now(),
        paused: false,
        done: false,
        maxTech: g.maxTech,
        clues: g.clues
      };
      setLoading(false);
      clearHint();
      render();
      updateMeta();
      startTimer();
      persist();

      if (mode === 'daily') {
        toast('每日挑战 · ' + keyToLabel(dateKey) + ' · ' + LEVEL_NAME[level]);
      }
      if (settings.coach && !store.settings.welcomed) {
        // 首次进入的引导由欢迎面板负责
      } else if (settings.coach && opts.guided) {
        coachSay('开始', '点一个空格选中它——教练会显示这个格子还剩下哪些可能。再按下方数字键填数，数字不能和同行、同列、同宫里的重复。', [
          { label: '懂了', act: closeCoach }
        ]);
      }
    }, 30);
  }

  function setLoading(on) {
    if (on) {
      UI.board.classList.add('loading');
      UI.board.setAttribute('data-loading', '出题中…');
    } else {
      UI.board.classList.remove('loading');
      UI.board.removeAttribute('data-loading');
    }
  }

  // ---------------- 计时 ----------------
  function elapsedMs() {
    if (!st) return 0;
    if (st.done || st.paused) return st.accumulated;
    return st.accumulated + (Date.now() - st.runFrom);
  }

  function fmt(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
  }

  function startTimer() {
    if (timerId) clearInterval(timerId);
    timerId = setInterval(() => {
      if (!st) return;
      UI.clock.textContent = fmt(elapsedMs());
      UI.clock.classList.toggle('paused', st.paused);
    }, 250);
    UI.clock.textContent = fmt(elapsedMs());
  }

  function togglePause() {
    if (!st || st.done) return;
    if (st.paused) {
      st.runFrom = Date.now();
      st.paused = false;
      UI.board.classList.remove('dim');
      toast('继续');
    } else {
      st.accumulated = elapsedMs();
      st.paused = true;
      UI.board.classList.add('dim');
      clearHint();
    }
    persist();
  }

  // ---------------- 渲染 ----------------
  function buildBoard() {
    UI.board.innerHTML = '';
    cells = [];
    for (let i = 0; i < 81; i++) {
      const el = document.createElement('div');
      el.className = 'cell';
      el.dataset.r = Math.floor(i / 9);
      el.dataset.c = i % 9;
      el.dataset.i = i;
      el.setAttribute('role', 'gridcell');
      const val = document.createElement('span');
      val.className = 'val';
      const notes = document.createElement('div');
      notes.className = 'notes';
      for (let v = 1; v <= 9; v++) {
        const sp = document.createElement('span');
        sp.textContent = v;
        notes.appendChild(sp);
      }
      el.appendChild(val);
      el.appendChild(notes);
      UI.board.appendChild(el);
      cells.push({ el, val, notes: Array.from(notes.children) });
    }
  }

  function render() {
    if (!st) return;
    const selVal = st.selected >= 0 ? st.grid[st.selected] : 0;
    const showCand = settings.coach && !st.done && !st.paused && st.selected >= 0;
    const cand = showCand ? S.candidates(st.grid) : null;

    for (let i = 0; i < 81; i++) {
      const c = cells[i];
      if (!c) continue;
      const v = st.grid[i];
      const cls = ['cell'];
      if (st.puzzle[i]) cls.push('given');
      else if (v) cls.push('user');
      if (st.wrong.has(i)) cls.push('wrong');
      if (i === st.selected) {
        cls.push('sel');
      } else if (st.selected >= 0 &&
        (S.ROW[i] === S.ROW[st.selected] || S.COL[i] === S.COL[st.selected] || S.BOX[i] === S.BOX[st.selected])) {
        cls.push('peer');
      }
      if (selVal && v === selVal && i !== st.selected) cls.push('samenum');
      if (st.hint) {
        if (st.hint.idx === i) cls.push('hint-target');
        else if (st.hint.peers && st.hint.peers.indexOf(i) >= 0) cls.push('hint-peer');
        else if (st.hint.elim && st.hint.elim.indexOf(i) >= 0) cls.push('hint-elim');
      }
      c.el.className = cls.join(' ');
      c.val.textContent = v ? v : '';

      let noteVals = null;
      let autoCand = false;
      if (!v) {
        if (st.notes[i].size) noteVals = st.notes[i];
        else if (cand && i === st.selected && cand[i]) { noteVals = new Set(S.bits(cand[i])); autoCand = true; }
      }
      c.notes.forEach((n) => n.classList.toggle('auto', autoCand));
      for (let k = 0; k < 9; k++) {
        c.notes[k].classList.toggle('on', !!(noteVals && noteVals.has(k + 1)));
      }
      c.el.setAttribute('aria-label',
        '第' + (Math.floor(i / 9) + 1) + '行第' + (i % 9 + 1) + '列' + (v ? '，' + v : '，空'));
    }

    // 统计
    let filled = 0;
    for (let i = 0; i < 81; i++) if (st.grid[i]) filled++;
    UI.statErrors.textContent = st.errors;
    UI.statErrors.classList.toggle('err', st.errors > 0);
    UI.statHints.textContent = st.hints;
    const totalEmpty = Math.max(1, 81 - st.clues);
    UI.statFilled.textContent = Math.round((filled - st.clues) / totalEmpty * 100) + '%';

    // 数字键盘剩余
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 81; i++) if (st.grid[i]) counts[st.grid[i]]++;
    for (let v = 1; v <= 9; v++) {
      const btn = UI.padNums.querySelector('[data-v="' + v + '"]');
      if (!btn) continue;
      const left = 9 - counts[v];
      const lab = btn.querySelector('.left');
      if (lab) lab.textContent = left > 0 ? left : '';
      btn.classList.toggle('done', left <= 0);
      btn.disabled = left <= 0;
      let strike = btn.querySelector('.strike');
      if (left <= 0 && !strike) {
        strike = document.createElement('span');
        strike.className = 'strike';
        btn.appendChild(strike);
      } else if (left > 0 && strike) {
        strike.remove();
      }
    }

    UI.btnNote.classList.toggle('active', st.noteMode);
    UI.btnNote.setAttribute('aria-pressed', st.noteMode);
    const fnNote = $('fnNote');
    if (fnNote) fnNote.classList.toggle('active', st.noteMode);
    UI.btnHint.disabled = st.done;
  }

  function updateMeta() {
    UI.modeLabel.textContent = st.mode === 'daily' ? '每日挑战' : '练习';
    UI.levelLabel.textContent = LEVEL_NAME[st.level];
    UI.rankChip.textContent = st.clues + ' 提示';
    UI.rankChip.className = 'rank' + (st.level === 'expert' ? ' expert' : st.level === 'hard' ? ' hard' : '');
    renderLevels();
    renderDaily();
    renderRecords();
  }

  function renderLevels() {
    UI.levels.innerHTML = '<h3>难度</h3>';
    LEVEL_ORDER.forEach((lv) => {
      const b = document.createElement('button');
      b.className = 'level' + (st && st.level === lv && st.mode === 'practice' ? ' active' : '');
      const best = store.best[lv];
      b.innerHTML = '<span class="lv-name">' + LEVEL_NAME[lv] + '</span>' +
        '<span class="lv-meta">' + (best ? '最佳 ' + fmt(best.time * 1000) : S.LEVELS[lv].clues + ' 提示') + '</span>';
      b.onclick = () => newGame(lv, { mode: 'practice' });
      UI.levels.appendChild(b);
    });
  }

  function streakCount() {
    let count = 0;
    const d = new Date();
    // 今天没完成则从昨天开始数
    let cursor = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const kToday = todayKey();
    if (!store.daily[kToday]) cursor.setDate(cursor.getDate() - 1);
    for (let i = 0; i < 400; i++) {
      const k = cursor.getFullYear() * 10000 + (cursor.getMonth() + 1) * 100 + cursor.getDate();
      if (store.daily[k]) { count++; cursor.setDate(cursor.getDate() - 1); }
      else break;
    }
    return count;
  }

  function renderDaily() {
    const k = todayKey();
    const done = store.daily[k];
    const lv = dailyLevelFor(k);
    const streak = streakCount();
    const d = new Date();
    const week = '日一二三四五六'[d.getDay()];

    let dots = '';
    for (let i = 6; i >= 0; i--) {
      const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
      const kk = dd.getFullYear() * 10000 + (dd.getMonth() + 1) * 100 + dd.getDate();
      const cls = store.daily[kk] ? (i === 0 ? 'today on' : 'on') : (i === 0 ? 'today' : '');
      dots += '<i class="' + cls + '"></i>';
    }

    UI.daily.innerHTML =
      '<h3>每日挑战</h3>' +
      '<div class="daily-head">' +
        '<div><div class="daily-date">' + keyToLabel(k) + ' · 周' + week + '</div>' +
        '<div class="daily-sub">今天是一道「' + LEVEL_NAME[lv] + '」题，全世界同一份</div></div>' +
        (streak > 0 ? '<span class="streak">连续 ' + streak + ' 天</span>' : '') +
      '</div>' +
      '<div class="daily-dots">' + dots + '</div>' +
      '<button class="daily-btn' + (done ? ' done' : '') + '" id="btnDaily">' +
        (done ? '今天已完成 · ' + fmt(done.time * 1000) + ' · 再战一次' : '开始今天的挑战') +
      '</button>';

    const btn = $('btnDaily');
    if (btn) btn.onclick = () => newGame(lv, { mode: 'daily' });
  }

  function renderRecords() {
    let html = '';
    LEVEL_ORDER.forEach((lv) => {
      const b = store.best[lv];
      html += '<div class="rec-row"><span class="rec-name">' + LEVEL_NAME[lv] + '</span>' +
        '<span class="rec-val' + (b ? '' : ' empty') + '">' + (b ? fmt(b.time * 1000) : '—') + '</span></div>';
    });
    const wins = store.stats.wins, games = store.stats.games;
    html += '<div class="rec-row"><span class="rec-name">完成 / 开局</span><span class="rec-val">' + wins + ' / ' + games + '</span></div>';
    if (wins > 0) {
      html += '<div class="rec-row"><span class="rec-name">平均用时</span><span class="rec-val">' +
        fmt((store.stats.seconds / wins) * 1000) + '</span></div>';
    }
    UI.recordList.innerHTML = html;
  }

  // ---------------- 交互 ----------------
  function selectCell(i) {
    if (!st || st.done || st.paused) return;
    st.selected = i;
    if (!st.puzzle[i]) Sound.select();
    render();
    persist();
  }

  function pushHistory(entry) {
    st.history.push(entry);
    if (st.history.length > 200) st.history.shift();
  }

  function inputValue(v) {
    if (!st || st.done || st.paused) return;
    if (st.selected < 0) {
      // 自动选第一个空格，键盘流更顺
      for (let i = 0; i < 81; i++) if (!st.grid[i]) { st.selected = i; break; }
      if (st.selected < 0) return;
    }
    const i = st.selected;
    if (st.puzzle[i]) {
      toast('题目给出的数字不能改');
      return;
    }

    if (st.noteMode && !st.grid[i]) {
      pushHistory({ i, type: 'note', prev: new Set(st.notes[i]) });
      if (st.notes[i].has(v)) st.notes[i].delete(v);
      else st.notes[i].add(v);
      Sound.note();
      render(); persist();
      return;
    }

    if (st.grid[i] === v) {
      // 再按一次同一数字 = 擦掉
      eraseCell();
      return;
    }

    pushHistory({ i, type: 'value', prev: st.grid[i], prevNotes: new Set(st.notes[i]) });
    st.grid[i] = v;
    st.notes[i].clear();

    if (v !== st.solution[i]) {
      st.errors++;
      st.wrong.add(i);
      Sound.error();
      if (navigator.vibrate) navigator.vibrate(30);
      render();
      const el = cells[i].el;
      el.classList.add('shake');
      setTimeout(() => el.classList.remove('shake'), 380);
      persist();
      if (settings.coach) {
        coachSay('这里差一点', '这个格子不是 ' + v + '。看看它所在的这一行、这一列和第 ' + (S.BOX[i] + 1) + ' 宫里，哪个数字还没出现。', [
          { label: '给我提示', solid: true, act: () => { clearHint(); requestHint(); } },
          { label: '我自己来', act: closeCoach }
        ], 9000);
      }
      return;
    }

    st.wrong.delete(i);
    Sound.place();
    if (navigator.vibrate) navigator.vibrate(8);

    // 清掉同伴里的这个数字笔记
    for (const p of S.PEERS[i]) if (st.notes[p].has(v)) st.notes[p].delete(v);

    render();
    const el = cells[i].el;
    el.classList.add('pop', 'flash');
    setTimeout(() => { el.classList.remove('pop', 'flash'); }, 520);

    // 单元完成
    const units = [S.ROW[i], 9 + S.COL[i], 18 + S.BOX[i]];
    const justDone = units.filter((u) => S.UNITS[u].every((j) => st.grid[j] === st.solution[j]));
    if (justDone.length) {
      setTimeout(() => Sound.unit(), 120);
      justDone.forEach((u) => {
        S.UNITS[u].forEach((j) => {
          const e = cells[j].el;
          e.classList.add('flash');
          setTimeout(() => e.classList.remove('flash'), 700);
        });
      });
    }

    if (checkWin()) return;
    persist();
  }

  function eraseCell() {
    if (!st || st.done || st.paused) return;
    const i = st.selected;
    if (i < 0 || st.puzzle[i]) return;
    if (!st.grid[i] && !st.notes[i].size) return;
    pushHistory({ i, type: 'erase', prev: st.grid[i], prevNotes: new Set(st.notes[i]) });
    st.grid[i] = 0;
    st.notes[i].clear();
    st.wrong.delete(i);
    Sound.erase();
    render(); persist();
  }

  function undo() {
    if (!st || st.done || st.paused) return;
    const h = st.history.pop();
    if (!h) { toast('没有可撤销的步骤'); return; }
    st.grid[h.i] = h.prev || 0;
    st.notes[h.i] = new Set(h.prevNotes || []);
    st.wrong.delete(h.i);
    st.selected = h.i;
    Sound.undo();
    render(); persist();
  }

  function toggleNote() {
    if (!st || st.done) return;
    st.noteMode = !st.noteMode;
    Sound.note();
    render(); persist();
    if (st.noteMode) toast('笔记模式：填入的数字会记成小字候选');
  }

  // ---------------- 提示 / 教练 ----------------
  function clearHint() {
    if (!st) return;
    st.hint = null;
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
    render();
  }

  function requestHint() {
    if (!st || st.done) return;
    closeCoach();
    // 若选中的是错填格，先处理它
    let solver = new S.LogicSolver(st.grid);
    // 清掉错填，避免污染推理
    let hadWrong = false;
    for (const i of Array.from(st.wrong)) {
      if (st.grid[i] && st.grid[i] !== st.solution[i]) { solver.grid[i] = 0; hadWrong = true; }
    }
    if (hadWrong) solver = new S.LogicSolver(solver.grid);

    let step = solver.step();

    if (!step) {
      // 逻辑上无解（多半是历史错填），给出一个正确答案
      const empties = [];
      for (let i = 0; i < 81; i++) if (st.grid[i] !== st.solution[i]) empties.push(i);
      if (!empties.length) return;
      const i = empties[0];
      st.hints++;
      st.hint = { idx: i, peers: S.PEERS[i].slice(), elim: [] };
      Sound.hint();
      render(); persist();
      showHintCoach({
        title: '直接告诉你',
        text: S.cellName(i) + ' 应该是 ' + st.solution[i] + '。这一局有些格子填错了，建议先用撤销或擦除把它们清掉，再继续推理。',
        value: st.solution[i], idx: i
      });
      return;
    }

    // 过滤掉错误格带来的无效排除
    st.hints++;
    Sound.hint();

    if (step.value && step.idx >= 0) {
      st.hint = {
        idx: step.idx,
        peers: (step.peers || S.PEERS[step.idx]).slice(),
        elim: []
      };
      render(); persist();
      const detailed = settings.coach;
      showHintCoach({
        title: step.title,
        text: detailed ? step.text : ('试试 ' + S.cellName(step.idx) + '：这里能填 ' + step.value + '。'),
        value: step.value, idx: step.idx
      });
    } else if (step.eliminations) {
      st.hint = {
        idx: -1,
        peers: [],
        elim: step.eliminations.map((e) => e.idx)
      };
      render(); persist();
      showHintCoach({
        title: step.title,
        text: step.text,
        apply: step
      });
    } else {
      toast('暂时没有可用的提示');
    }
  }

  function showHintCoach(o) {
    const actions = [];
    if (o.value) {
      actions.push({
        label: '填入 ' + o.value, solid: true,
        act: () => {
          st.selected = o.idx;
          inputValue(o.value);
          closeCoach();
          clearHint();
        }
      });
    }
    if (o.apply) {
      actions.push({
        label: '把这些候选数划掉', solid: true,
        act: () => { applyEliminations(o.apply); closeCoach(); clearHint(); }
      });
    }
    actions.push({ label: '知道了', act: closeCoach });
    coachSay(o.title, o.text, actions, 0);
  }

  function applyEliminations(step) {
    const cand = S.candidates(st.grid);
    const needFill = new Set();
    for (const e of step.eliminations) if (st.notes[e.idx].size === 0) needFill.add(e.idx);
    needFill.forEach((idx) => S.bits(cand[idx]).forEach((v) => st.notes[idx].add(v)));
    for (const e of step.eliminations) {
      st.notes[e.idx].delete(e.value);
    }
    Sound.note();
    render(); persist();
    toast('已按提示更新笔记');
  }

  function coachSay(tag, text, actions, autoHide) {
    UI.coachTag.textContent = tag || '教练';
    UI.coachText.textContent = text;
    UI.coachActions.innerHTML = '';
    (actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.textContent = a.label;
      if (a.solid) b.className = 'solid';
      b.onclick = a.act;
      UI.coachActions.appendChild(b);
    });
    UI.coach.classList.add('show');
    if (autoHide) {
      clearTimeout(coachSay._t);
      coachSay._t = setTimeout(closeCoach, autoHide);
    }
  }

  function closeCoach() {
    UI.coach.classList.remove('show');
    clearTimeout(coachSay._t);
  }

  // ---------------- 胜利 ----------------
  function checkWin() {
    for (let i = 0; i < 81; i++) if (st.grid[i] !== st.solution[i]) return false;
    st.accumulated = elapsedMs();
    st.done = true;
    st.selected = -1;
    st.hint = null;
    closeCoach();
    clearInterval(timerId);
    Sound.win();
    if (navigator.vibrate) navigator.vibrate([18, 60, 18]);
    render();

    const seconds = Math.round(st.accumulated / 1000);
    const perfect = st.errors === 0 && st.hints === 0;
    store.stats.games++;
    store.stats.wins++;
    store.stats.seconds += seconds;

    const prev = store.best[st.level];
    const isBest = !prev || seconds < prev.time;
    if (isBest) {
      store.best[st.level] = { time: seconds, errors: st.errors, hints: st.hints, date: todayKey() };
    }
    if (st.mode === 'daily') {
      const old = store.daily[st.dateKey];
      if (!old || seconds < old.time) {
        store.daily[st.dateKey] = { time: seconds, errors: st.errors, hints: st.hints, level: st.level };
      }
    }
    persist();
    updateMeta();
    showWin(seconds, perfect, isBest);
    return true;
  }

  function showWin(seconds, perfect, isBest) {
    const medals = [];
    if (perfect) medals.push('零失误 · 零提示');
    if (isBest && st.level) medals.push('新纪录');
    if (st.mode === 'daily') medals.push('每日挑战 #' + st.dateKey);

    const shareText = '我在 54hrm 数独完成了「' + LEVEL_NAME[st.level] + '」，用时 ' + fmt(seconds * 1000) +
      (perfect ? '，零失误零提示' : '') + '。 game.54hrm.com';

    UI.modalCard.innerHTML =
      '<h2>' + (perfect ? '干净利落' : '完成') + '</h2>' +
      '<p class="lead">' + LEVEL_NAME[st.level] + ' · ' + st.clues + ' 个提示数' +
      (st.mode === 'daily' ? ' · 每日挑战' : '') + '</p>' +
      '<div class="big-time">' + fmt(seconds * 1000) + '</div>' +
      '<div class="medals">' +
        medals.map((m) => '<span class="medal">' + m + '</span>').join('') +
        '<span class="medal gray">失误 ' + st.errors + ' 次</span>' +
        '<span class="medal gray">提示 ' + st.hints + ' 次</span>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn primary" id="winNext">再来一局（' + LEVEL_NAME[st.level] + '）</button>' +
        '<div class="btn-row">' +
          '<button class="btn" id="winShare">复制成绩</button>' +
          '<button class="btn" id="winDaily">每日挑战</button>' +
        '</div>' +
      '</div>';

    openModal();
    $('winNext').onclick = () => { closeModal(); newGame(st.level, { mode: 'practice' }); };
    $('winShare').onclick = () => copyText(shareText);
    $('winDaily').onclick = () => {
      closeModal();
      const k = todayKey();
      newGame(dailyLevelFor(k), { mode: 'daily' });
    };
  }

  function copyText(text) {
    const done = () => toast('成绩已复制，去分享吧');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallback());
    } else fallback();
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，手动选中吧'); }
      ta.remove();
    }
  }

  // ---------------- 面板 ----------------
  function openModal() { UI.modal.classList.add('show'); }
  function closeModal() { UI.modal.classList.remove('show'); }

  function showWelcome() {
    settings.welcomed = true;
    persist();
    UI.modalCard.innerHTML =
      '<h2>欢迎来玩数独</h2>' +
      '<p class="lead">每天五分钟的数字练习。规则很简单：</p>' +
      '<ul class="rules">' +
        '<li>每一<b>行</b>、每一<b>列</b>、每个 <b>3×3 宫</b>里，1 到 9 各出现一次。</li>' +
        '<li>题目给的深色数字不能改，你填的数字是<b>青色</b>的。</li>' +
        '<li>卡住时按「提示」，教练会告诉你这一步为什么这么填。</li>' +
        '<li>想练候选数就开「笔记」，每个空格里能记下多个可能值。</li>' +
      '</ul>' +
      '<div class="kbd-line">' +
        '<span>1-9 填数</span><span>方向键移动</span><span>N 笔记</span><span>H 提示</span><span>空格 暂停</span>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn primary" id="startEasy">从入门开始</button>' +
        '<div class="btn-row">' +
          '<button class="btn" id="startMedium">直接进阶</button>' +
          '<button class="btn" id="closeWelcome">先看看</button>' +
        '</div>' +
      '</div>';
    openModal();
    $('startEasy').onclick = () => { closeModal(); settings.welcomed = true; persist(); newGame('easy', { mode: 'practice', guided: true }); };
    $('startMedium').onclick = () => { closeModal(); settings.welcomed = true; persist(); newGame('medium', { mode: 'practice', guided: true }); };
    $('closeWelcome').onclick = () => { closeModal(); settings.welcomed = true; persist(); };
  }

  function showHelp() {
    UI.modalCard.innerHTML =
      '<h2>玩法</h2>' +
      '<ul class="rules">' +
        '<li>每行、每列、每宫填 1-9，不能重复。</li>' +
        '<li><b>提示</b>会解释推理：唯一候选、隐性唯一、数对、区块排除、X-Wing。</li>' +
        '<li><b>教练模式</b>（右上角星标）会显示候选数，并把提示讲得更细。</li>' +
        '<li><b>每日挑战</b>每天一道固定题，连胜天数会累积。</li>' +
        '<li>进度自动保存在本机浏览器，刷新不丢。</li>' +
      '</ul>' +
      '<div class="kbd-line">' +
        '<span>1-9 填数</span><span>0 / Backspace 擦除</span><span>方向键移动</span>' +
        '<span>N 笔记</span><span>U 撤销</span><span>H 提示</span><span>空格 暂停</span>' +
      '</div>' +
      '<div class="modal-actions"><button class="btn primary" id="helpClose">开始玩</button></div>';
    openModal();
    $('helpClose').onclick = closeModal;
  }

  let toastTimer = null;
  function toast(msg) {
    UI.toast.textContent = msg;
    UI.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => UI.toast.classList.remove('show'), 1900);
  }

  // ---------------- 保存 / 恢复 ----------------
  function serialize() {
    if (!st || st.done) return null;
    return {
      level: st.level, mode: st.mode, dateKey: st.dateKey,
      puzzle: Array.from(st.puzzle),
      solution: Array.from(st.solution),
      grid: Array.from(st.grid),
      notes: st.notes.map((s) => Array.from(s)),
      errors: st.errors, hints: st.hints,
      accumulated: elapsedMs(),
      clues: st.clues, maxTech: st.maxTech
    };
  }

  function restore(save) {
    if (!save || !save.puzzle || save.puzzle.length !== 81) return false;
    if (save.mode === 'daily' && save.dateKey !== todayKey()) return false;
    st = {
      level: save.level, mode: save.mode, dateKey: save.dateKey,
      puzzle: Uint8Array.from(save.puzzle),
      solution: Uint8Array.from(save.solution),
      grid: Uint8Array.from(save.grid),
      notes: save.notes.map((a) => new Set(a)),
      selected: -1,
      noteMode: false,
      errors: save.errors || 0,
      hints: save.hints || 0,
      wrong: new Set(),
      history: [],
      accumulated: save.accumulated || 0,
      runFrom: Date.now(),
      paused: false,
      done: false,
      clues: save.clues || 0,
      maxTech: save.maxTech || 0,
      restored: true
    };
    // 恢复后重算错填
    for (let i = 0; i < 81; i++) if (st.grid[i] && st.grid[i] !== st.solution[i]) st.wrong.add(i);
    render();
    updateMeta();
    startTimer();
    return true;
  }

  // ---------------- 初始化 ----------------
  function buildPad() {
    UI.padNums.innerHTML = '';
    for (let v = 1; v <= 9; v++) {
      const b = document.createElement('button');
      b.className = 'key';
      b.dataset.v = v;
      b.innerHTML = v + '<span class="left"></span>';
      b.onclick = () => inputValue(v);
      UI.padNums.appendChild(b);
    }
  }

  function bindEvents() {
    UI.board.addEventListener('click', (e) => {
      const el = e.target.closest('.cell');
      if (!el) return;
      selectCell(Number(el.dataset.i));
    });

    UI.btnPause.onclick = togglePause;
    UI.btnNote.onclick = toggleNote;
    $('fnNote').onclick = toggleNote;
    UI.btnUndo.onclick = undo;
    $('fnUndo').onclick = undo;
    $('fnErase').onclick = eraseCell;
    UI.btnHint.onclick = requestHint;
    $('fnHint').onclick = requestHint;
    UI.btnNew.onclick = () => newGame(st ? st.level : 'medium', { mode: 'practice' });
    $('coachClose').onclick = closeCoach;
    UI.modal.onclick = (e) => { if (e.target === UI.modal) closeModal(); };
    $('btnHelp').onclick = showHelp;

    UI.btnSound.onclick = () => {
      settings.sound = !settings.sound;
      Sound.setEnabled(settings.sound);
      renderSoundIcon();
      persist();
      if (settings.sound) Sound.place();
    };

    UI.btnGuide.onclick = () => {
      settings.coach = !settings.coach;
      renderGuideIcon();
      persist();
      render();
      toast(settings.coach ? '教练模式已开：显示候选数、提示讲得更细' : '教练模式已关：界面更干净');
    };

    document.addEventListener('keydown', (e) => {
      if (UI.modal.classList.contains('show')) {
        if (e.key === 'Escape') closeModal();
        return;
      }
      if (!st) return;
      if (e.key >= '1' && e.key <= '9') { inputValue(Number(e.key)); e.preventDefault(); return; }
      if (e.key === '0' || e.key === 'Backspace' || e.key === 'Delete') { eraseCell(); e.preventDefault(); return; }
      if (e.key === ' ') { togglePause(); e.preventDefault(); return; }
      const k = e.key.toLowerCase();
      if (k === 'n') { toggleNote(); return; }
      if (k === 'u' || (e.metaKey && k === 'z') || (e.ctrlKey && k === 'z')) { undo(); e.preventDefault(); return; }
      if (k === 'h') { requestHint(); return; }
      if (e.key === 'Escape') { closeCoach(); return; }
      const move = (dr, dc) => {
        let i = st.selected < 0 ? 40 : st.selected;
        let r = Math.floor(i / 9) + dr, c = (i % 9) + dc;
        r = (r + 9) % 9; c = (c + 9) % 9;
        selectCell(r * 9 + c);
        e.preventDefault();
      };
      if (e.key === 'ArrowUp') move(-1, 0);
      else if (e.key === 'ArrowDown') move(1, 0);
      else if (e.key === 'ArrowLeft') move(0, -1);
      else if (e.key === 'ArrowRight') move(0, 1);
    });

    window.addEventListener('beforeunload', () => { if (st && !st.done) { st.accumulated = elapsedMs(); persist(); } });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && st && !st.paused && !st.done) {
        st.accumulated = elapsedMs();
        st.paused = true;
        UI.board.classList.add('dim');
        persist();
      }
    });
  }

  function renderSoundIcon() {
    UI.btnSound.setAttribute('aria-pressed', String(settings.sound));
    UI.btnSound.classList.toggle('on', settings.sound);
    const svg = UI.btnSound.querySelector('svg');
    if (!svg) return;
    const w1 = svg.querySelector('.wave');
    const w2 = svg.querySelector('.wave2');
    const x = svg.querySelector('.mute-x');
    const show = settings.sound ? '' : 'none';
    if (w1) w1.style.display = show;
    if (w2) w2.style.display = show;
    if (x) x.style.display = settings.sound ? 'none' : '';
  }

  function renderGuideIcon() {
    UI.btnGuide.classList.toggle('on', settings.coach);
    UI.btnGuide.setAttribute('aria-pressed', String(settings.coach));
  }

  function boot() {
    buildBoard();
    buildPad();
    bindEvents();
    Sound.setEnabled(settings.sound);
    Sound.setVolume(settings.volume);
    renderSoundIcon();
    renderGuideIcon();
    UI.modalCard.innerHTML = '';
    if (!restore(store.save)) {
      newGame('medium', { mode: 'practice' });
    }
    if (!settings.welcomed && !store.save) {
      setTimeout(showWelcome, 400);
    }
  }

  // 调试/自动化入口（无副作用，仅暴露只读状态与主要动作）
  window.__sd = {
    state: () => st,
    select: selectCell,
    input: inputValue,
    hint: requestHint,
    newGame
  };

  boot();
})();

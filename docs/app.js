// 教育用途的“概念模型”：
// - 我们用一个线性 byte 数组模拟一个典型栈帧内的布局：
//   buf(16) → canary(8) → saved RBP(8) → return address(8)
// - “越界写”就是从 buf[0] 开始连续写入 N 字节，超过 16 后会覆盖后面的字段。
// - 我们用“返回前检查 canary”模拟 stack protector；用 NX/ASLR 作为结论层面的开关展示。

const SIZES = {
  buf: 16,
  canary: 8,
  rbp: 8,
  ret: 8,
};

const OFFSETS = {
  buf: 0,
  canary: SIZES.buf,
  rbp: SIZES.buf + SIZES.canary,
  ret: SIZES.buf + SIZES.canary + SIZES.rbp,
};

const FRAME_LEN = SIZES.buf + SIZES.canary + SIZES.rbp + SIZES.ret;

const el = (id) => document.getElementById(id);

function segmentLabel(seg) {
  if (seg === "buf") return "buf（局部缓冲区）";
  if (seg === "canary") return "canary（哨兵值/示意）";
  if (seg === "rbp") return "saved RBP（帧指针/示意）";
  return "return addr（返回地址/示意）";
}

function segmentShort(seg) {
  if (seg === "buf") return "buf";
  if (seg === "canary") return "canary";
  if (seg === "rbp") return "saved RBP";
  if (seg === "ret") return "return addr";
  return "未知字段";
}

function toHex(b) {
  return b.toString(16).padStart(2, "0").toUpperCase();
}

function toAscii(b) {
  if (b >= 0x20 && b <= 0x7e) return String.fromCharCode(b);
  return ".";
}

function randByte() {
  // 浏览器内置随机足够用于展示；不是安全讨论重点
  return Math.floor(Math.random() * 256);
}

function u64LE(bytes8) {
  let v = 0n;
  for (let i = 7; i >= 0; i--) {
    v = (v << 8n) | BigInt(bytes8[i]);
  }
  return v;
}

function setU64LE(mem, offset, valueBigInt) {
  let v = valueBigInt;
  for (let i = 0; i < 8; i++) {
    mem[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

function getSlice(mem, offset, len) {
  return mem.slice(offset, offset + len);
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function segmentNameAtIndex(i) {
  if (i < OFFSETS.canary) return "buf";
  if (i < OFFSETS.rbp) return "canary";
  if (i < OFFSETS.ret) return "rbp";
  return "ret";
}

function mkPatternBytes(mode, customText) {
  // 返回一个“无限序列”的生成器函数：idx -> byte
  if (mode === "A") {
    return () => 0x41;
  }
  if (mode === "ABCD") {
    const seq = [0x41, 0x42, 0x43, 0x44];
    return (i) => seq[i % seq.length];
  }
  if (mode === "random") {
    return () => randByte();
  }
  // custom
  const s = (customText ?? "").toString();
  const bytes = Array.from(s).map((ch) => ch.charCodeAt(0) & 0xff);
  if (bytes.length === 0) return () => 0x3f; // '?'
  return (i) => bytes[i % bytes.length];
}

function explainAddressLike(aslrEnabled) {
  // 纯展示：不给出可利用细节，只描述“地址会变”
  const base = aslrEnabled ? randByte() : 0x40;
  const mk = (tag) =>
    `0x7ffd_${toHex(base)}${tag}${toHex((base + 0x22) & 0xff)}_${toHex(
      (base + 0x10) & 0xff
    )}`;
  return {
    buf: mk("B"),
    ret: mk("R"),
  };
}

function createFrame() {
  const mem = new Uint8Array(FRAME_LEN);

  // 初始化为 0
  mem.fill(0x00);

  // “canary”用随机 8 字节模拟（教育演示）
  const canaryBytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) canaryBytes[i] = randByte();
  for (let i = 0; i < 8; i++) mem[OFFSETS.canary + i] = canaryBytes[i];

  // saved RBP / return address：用“看起来像指针”的数值填充（不对应真实地址）
  setU64LE(mem, OFFSETS.rbp, 0x00007fff_f0f0f0f0n);
  setU64LE(mem, OFFSETS.ret, 0x00005555_11112222n);

  return {
    mem,
    initial: {
      canary: canaryBytes,
      rbp: getSlice(mem, OFFSETS.rbp, 8),
      ret: getSlice(mem, OFFSETS.ret, 8),
    },
  };
}

function renderFrame(container, state) {
  container.innerHTML = "";

  const frameCol = document.createElement("div");
  frameCol.className = "frameCol";

  const segments = [
    { key: "buf", title: "buf", size: SIZES.buf, tagClass: "tag--buf" },
    { key: "canary", title: "canary", size: SIZES.canary, tagClass: "tag--canary" },
    { key: "rbp", title: "saved RBP", size: SIZES.rbp, tagClass: "tag--rbp" },
    { key: "ret", title: "return addr", size: SIZES.ret, tagClass: "tag--ret" },
  ];

  for (const seg of segments) {
    const segEl = document.createElement("div");
    segEl.className = "segment";

    const title = document.createElement("div");
    title.className = "segTitle";

    const left = document.createElement("div");
    left.innerHTML = `<span class="name">${seg.title}</span> <span class="meta">${seg.size} bytes</span>`;

    const right = document.createElement("div");
    right.className = `tag ${seg.tagClass}`;
    right.textContent = state.segmentHints[seg.key] ?? "";

    title.appendChild(left);
    title.appendChild(right);
    segEl.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "grid";

    const base = OFFSETS[seg.key];
    for (let i = 0; i < seg.size; i++) {
      const idx = base + i;
      const cell = document.createElement("div");
      cell.className = "cell";
      if (state.written[idx]) cell.classList.add("written");

      const b = state.mem[idx];
      cell.innerHTML = `<div class="hex">${toHex(b)}</div><div class="asc">${toAscii(
        b
      )}</div>`;
      grid.appendChild(cell);
    }

    segEl.appendChild(grid);
    frameCol.appendChild(segEl);
  }

  container.appendChild(frameCol);
}

function computeStatus(state) {
  const canaryNow = getSlice(state.mem, OFFSETS.canary, 8);
  const rbpNow = getSlice(state.mem, OFFSETS.rbp, 8);
  const retNow = getSlice(state.mem, OFFSETS.ret, 8);

  const canaryChanged = !bytesEqual(canaryNow, state.initial.canary);
  const rbpChanged = !bytesEqual(rbpNow, state.initial.rbp);
  const retChanged = !bytesEqual(retNow, state.initial.ret);

  const mitCanary = state.mitigations.canary;
  const mitNX = state.mitigations.nx;
  const mitASLR = state.mitigations.aslr;

  // 概念化“返回时会发生什么”
  let verdict = { level: "ok", text: "正常返回（模拟）" };

  if (mitCanary && canaryChanged) {
    verdict = { level: "bad", text: "检测到 Canary 被改写 → 立即终止（模拟）" };
  } else if (retChanged) {
    // 这里不做“跳到哪里”“怎么构造”的指导，只用抽象描述
    if (mitNX) {
      verdict = { level: "warn", text: "返回地址异常 → 可能崩溃；且 NX 降低栈上执行可能（模拟）" };
    } else {
      verdict = { level: "warn", text: "返回地址异常 → 控制流不可预测（模拟）" };
    }
  } else if (rbpChanged) {
    verdict = { level: "warn", text: "栈帧指针被破坏 → 后续访问局部变量/返回过程可能异常（模拟）" };
  } else if (canaryChanged) {
    verdict = { level: "warn", text: "相邻内存被覆盖（Canary 改写），但未启用校验（模拟）" };
  }

  const addr = explainAddressLike(mitASLR);
  const writtenCount = state.written.reduce((acc, v) => acc + (v ? 1 : 0), 0);

  const planLen = state.runtime?.planLen ?? 0;
  const cursor = state.runtime?.cursor ?? 0; // next write offset
  const nextAbs = OFFSETS.buf + cursor;
  const nextSeg =
    cursor >= planLen ? null : nextAbs >= FRAME_LEN ? "oob" : segmentNameAtIndex(nextAbs);
  const lastAbs = OFFSETS.buf + Math.max(0, cursor - 1);
  const lastSeg =
    cursor <= 0 ? null : lastAbs >= FRAME_LEN ? "oob" : segmentNameAtIndex(lastAbs);

  const finished = planLen > 0 && cursor >= planLen;
  const started = cursor > 0;

  return {
    canaryChanged,
    rbpChanged,
    retChanged,
    verdict,
    addr,
    writtenCount,
    canaryNow,
    retNow,
    runtime: {
      planLen,
      cursor,
      started,
      finished,
      nextSeg,
      lastSeg,
    },
  };
}

function pushNarration(state, text) {
  const rt = state.runtime ?? {};
  const log = Array.isArray(rt.log) ? rt.log.slice(0) : [];
  log.unshift({ t: Date.now(), text });
  while (log.length > 6) log.pop();
  state.runtime = { ...rt, log };
}

function describeNow(st) {
  const s = computeStatus(st);
  const r = s.runtime;
  const canaryEnabled = st.mitigations.canary;
  const canaryFail = canaryEnabled && s.canaryChanged;

  if (r.planLen === 0) {
    return "写入长度为 0：不会写入任何字节。";
  }

  if (!r.started) {
    return `准备从 buf[0] 开始写入，共 ${r.planLen} 字节。先点“单步写 1 字节”试试。`;
  }

  if (!r.finished) {
    const last = r.lastSeg;
    const next = r.nextSeg;
    const lastText = last && last !== "oob" ? segmentShort(last) : "（帧外）";
    const nextText = next && next !== "oob" ? segmentShort(next) : next === "oob" ? "（帧外）" : "（完成）";
    const warn = r.cursor > SIZES.buf ? "已经越界：开始覆盖相邻字段。" : "还未越界：仍在 buf 内。";
    return `刚写入第 ${r.cursor} 个字节（上一次落在 ${lastText}）。下一次将写到 ${nextText}。${warn}`;
  }

  // finished
  if (canaryFail) {
    return "写入完成，但 Canary 被改写：返回前检查会失败（模拟），通常在 ret 前终止。";
  }
  if (s.retChanged) {
    return "写入完成，返回地址已被改写：现实中 ret 时可能跳飞/崩溃（这里用抽象结论表示）。";
  }
  if (s.rbpChanged) {
    return "写入完成，saved RBP 被改写：现实中后续栈帧恢复/变量访问可能异常（模拟）。";
  }
  if (s.canaryChanged) {
    return "写入完成，canary 被改写：若未启用 Canary 校验，可能不立刻终止，但内存已被破坏（模拟）。";
  }
  return "写入完成：只写在 buf 内，没有覆盖到相邻字段。";
}

function renderNarration(narrationEl, logEl, st) {
  const s = computeStatus(st);
  const canaryEnabled = st.mitigations.canary;
  const canaryFail = canaryEnabled && s.canaryChanged;
  const phase = st.runtime?.phase ?? "write";

  const phaseText =
    phase === "write"
      ? "write（写入）"
      : phase === "check"
        ? "check（返回前校验）"
        : phase === "ret"
          ? "ret（返回）"
          : phase === "blocked"
            ? "blocked（已被阻断）"
            : "done（流程结束）";

  const headline = describeNow(st);
  narrationEl.innerHTML = `
    <div><span class="k">当前阶段：</span><b>${phaseText}</b></div>
    <div style="margin-top:8px">${headline}</div>
    <div style="margin-top:8px" class="muted">
      提醒：这只是概念模型。Canary/NX/ASLR 开关仅影响“模拟结论”，不改变你机器的系统设置。
      ${canaryFail ? "<br/><b class=\"bad\">Canary 失败：后续阶段将被阻断（模拟）。</b>" : ""}
    </div>
  `;

  const log = Array.isArray(st.runtime?.log) ? st.runtime.log : [];
  logEl.innerHTML = log
    .map((x) => `<div class="logItem">${x.text}</div>`)
    .join("");
}

function renderStatus(statusEl, st, writeLen) {
  const s = computeStatus(st);
  const vClass = s.verdict.level === "bad" ? "bad" : s.verdict.level === "warn" ? "warn" : "ok";

  const canaryU64 = u64LE(s.canaryNow);
  const retU64 = u64LE(s.retNow);

  statusEl.innerHTML = `
    <div><span class="k">写入长度：</span><b>${writeLen}</b> 字节（从 buf[0] 起）</div>
    <div><span class="k">已覆盖字节：</span><b>${s.writtenCount}</b> / ${FRAME_LEN}</div>
    <div style="margin-top:8px"><span class="k">模拟地址（仅示意）：</span> buf=${s.addr.buf}，ret=${s.addr.ret}</div>
    <div style="margin-top:8px"><span class="k">字段变化：</span>
      canary=${s.canaryChanged ? '<span class="bad">被改写</span>' : '<span class="ok">未改写</span>'}，
      saved RBP=${s.rbpChanged ? '<span class="bad">被改写</span>' : '<span class="ok">未改写</span>'}，
      return addr=${s.retChanged ? '<span class="bad">被改写</span>' : '<span class="ok">未改写</span>'}
    </div>
    <div style="margin-top:8px"><span class="k">当前 canary(u64 LE)：</span><b>0x${canaryU64.toString(16).padStart(16, "0")}</b></div>
    <div><span class="k">当前 return addr(u64 LE)：</span><b>0x${retU64.toString(16).padStart(16, "0")}</b></div>
    <div style="margin-top:10px"><span class="k">结论：</span><span class="${vClass}">${s.verdict.text}</span></div>
  `;
}

function renderInspector(pointerEl, fieldEl, timelineEl, st, writeLen) {
  const s = computeStatus(st);
  const r = s.runtime;

  // pointer
  const nextOffset = r.cursor;
  const planLen = r.planLen;
  const nextAbs = OFFSETS.buf + nextOffset;
  const nextAbsText = nextOffset >= planLen ? "（写入完成）" : nextAbs >= FRAME_LEN ? "（超出帧范围）" : "";

  pointerEl.innerHTML = `
    <div><span class="k">next offset：</span><b>${nextOffset}</b> / ${planLen}（0-based）</div>
    <div><span class="k">next 目标地址：</span><b>buf+${nextOffset}</b> ${nextAbsText}</div>
    <div style="margin-top:8px"><span class="k">提示：</span>${nextOffset <= SIZES.buf ? "未越界" : "已越界（开始覆盖相邻字段）"}</div>
  `;

  // field
  const nextSeg = r.nextSeg;
  const lastSeg = r.lastSeg;

  let fieldMsg = "";
  if (planLen === 0) {
    fieldMsg = "写入长度为 0：不会写入任何字节。";
  } else if (nextSeg === null) {
    fieldMsg = "写入已完成：没有“下一个”要覆盖的字节。";
  } else if (nextSeg === "oob") {
    fieldMsg = "继续写入会超出该“栈帧模型”范围（演示里不再绘制）。";
  } else {
    fieldMsg = `下一字节将落在 <b>${segmentLabel(nextSeg)}</b>。`;
  }

  const lastMsg =
    lastSeg && lastSeg !== "oob"
      ? `上一次写入落在 <b>${segmentLabel(lastSeg)}</b>。`
      : lastSeg === "oob"
        ? "上一次写入已超出该“栈帧模型”范围。"
        : "尚未写入任何字节。";

  fieldEl.innerHTML = `
    <div>${fieldMsg}</div>
    <div style="margin-top:8px" class="muted">${lastMsg}</div>
    <div style="margin-top:10px">
      <span class="k">阈值：</span>
      buf=${SIZES.buf}，
      canary 到 ${SIZES.buf + SIZES.canary}，
      rbp 到 ${SIZES.buf + SIZES.canary + SIZES.rbp}，
      ret 到 ${FRAME_LEN}
    </div>
  `;

  // timeline（带动效的抽象状态机）
  const canaryEnabled = st.mitigations.canary;
  const canaryFail = canaryEnabled && s.canaryChanged;
  const phase = st.runtime?.phase ?? "write"; // write | check | ret | done | blocked
  const flashWrite = !!st.runtime?.flashWrite;

  const writeState = r.planLen === 0 ? "done" : (r.finished ? "done" : "active");
  const checkState = !r.finished
    ? ""
    : canaryEnabled
      ? (phase === "check" ? "active" : (phase === "ret" || phase === "done") ? "done" : phase === "blocked" ? "blocked" : "active")
      : "done";
  const retState = !r.finished
    ? ""
    : (phase === "ret" ? "active" : phase === "done" ? "done" : phase === "blocked" ? "blocked" : "active");

  const steps = [
    {
      key: "call",
      title: "call（进入函数）",
      desc: "建立栈帧、分配局部变量空间（概念化）。",
      state: "done",
    },
    {
      key: "write",
      title: "write（写入缓冲区）",
      desc: "从 buf[0] 开始连续写入 N 字节；超过边界会覆盖相邻字段。",
      state: r.started ? writeState : "active",
      extraClass: flashWrite ? "flash" : "",
    },
    {
      key: "check",
      title: "check（返回前校验）",
      desc: canaryEnabled
        ? "启用 Canary：函数返回前会校验哨兵值是否被改写。"
        : "未启用 Canary：跳过该校验（仅模拟）。",
      state: checkState,
    },
    {
      key: "ret",
      title: "ret（返回）",
      desc: canaryFail
        ? "Canary 校验失败：通常在 ret 前终止进程（模拟）。"
        : "从栈中取回返回地址并跳转；若返回地址被改写，结果不可预测（模拟）。",
      state: retState,
    },
  ];

  timelineEl.innerHTML = steps
    .map((x) => {
      const cls = x.state ? `tlStep ${x.state} ${x.extraClass ?? ""}` : `tlStep ${x.extraClass ?? ""}`;
      return `
        <div class="${cls}">
          <div class="tlDot"></div>
          <div class="tlBody">
            <div class="t">${x.title}</div>
            <div class="d">${x.desc}</div>
          </div>
        </div>
      `;
    })
    .join("");
}

function buildSegmentHints() {
  return {
    buf: "局部缓冲区",
    canary: "哨兵值（示意）",
    rbp: "帧指针（示意）",
    ret: "返回地址（示意）",
  };
}

function init() {
  const memEl = el("mem");
  const statusEl = el("status");
  const narrationEl = el("narration");
  const narrationLogEl = el("narrationLog");
  const inspectorPointerEl = el("inspectorPointer");
  const inspectorFieldEl = el("inspectorField");
  const inspectorTimelineEl = el("inspectorTimeline");
  const writeLen = el("writeLen");
  const writeLenHint = el("writeLenHint");
  const pattern = el("pattern");
  const customRow = el("customRow");
  const customText = el("customText");

  const mitCanary = el("mitCanary");
  const mitNX = el("mitNX");
  const mitASLR = el("mitASLR");

  const btnReset = el("btnReset");
  const btnStep = el("btnStep");
  const btnRun = el("btnRun");

  let st = null;
  let cursor = 0;
  let planBytes = null;
  let timers = [];

  function clearTimers() {
    for (const id of timers) clearTimeout(id);
    timers = [];
  }

  function later(ms, fn) {
    const id = setTimeout(fn, ms);
    timers.push(id);
    return id;
  }

  function setPhase(p) {
    st.runtime = { ...(st.runtime ?? {}), phase: p };
  }

  function startAutoAdvance() {
    // 在写入完成后，自动推进 check → ret（概念演示）
    clearTimers();
    const s = computeStatus(st);
    const canaryEnabled = st.mitigations.canary;
    const canaryFail = canaryEnabled && s.canaryChanged;
    if (!s.runtime.finished) {
      setPhase("write");
      return;
    }
    if (canaryFail) {
      setPhase("blocked");
      pushNarration(st, "<b>check</b>：Canary 被改写 → 返回前检查失败，通常在 ret 前终止（模拟）。");
      return;
    }
    if (canaryEnabled) {
      setPhase("check");
      pushNarration(st, "<b>check</b>：开始做返回前校验（模拟）。");
      rerender();
      later(700, () => {
        setPhase("ret");
        pushNarration(st, "<b>ret</b>：准备返回（从栈中取回返回地址，模拟）。");
        rerender();
        later(700, () => {
          setPhase("done");
          pushNarration(st, "<b>done</b>：流程结束（模拟）。");
          rerender();
        });
      });
    } else {
      // 没有 canary：直接进入 ret
      setPhase("ret");
      pushNarration(st, "<b>ret</b>：未启用 Canary，直接进入返回（模拟）。");
      rerender();
      later(700, () => {
        setPhase("done");
        pushNarration(st, "<b>done</b>：流程结束（模拟）。");
        rerender();
      });
    }
  }

  function refreshHint() {
    const n = Number(writeLen.value);
    let msg = "";
    if (n <= SIZES.buf) msg = "（只写入 buf）";
    else if (n <= SIZES.buf + SIZES.canary) msg = "（将覆盖到 canary）";
    else if (n <= SIZES.buf + SIZES.canary + SIZES.rbp) msg = "（将覆盖到 saved RBP）";
    else msg = "（将覆盖到 return address）";
    writeLenHint.textContent = " " + msg;
  }

  function resetFrame() {
    clearTimers();
    const fr = createFrame();
    st = {
      mem: fr.mem,
      initial: fr.initial,
      written: new Array(FRAME_LEN).fill(false),
      mitigations: { canary: mitCanary.checked, nx: mitNX.checked, aslr: mitASLR.checked },
      segmentHints: buildSegmentHints(),
      runtime: { cursor: 0, planLen: Number(writeLen.value), phase: "write", flashWrite: false, log: [] },
    };
    cursor = 0;
    planBytes = null;
    pushNarration(st, "已重置栈帧：现在可以从 <b>buf[0]</b> 开始写入了。");
    renderFrame(memEl, st);
    renderStatus(statusEl, st, Number(writeLen.value));
    renderInspector(inspectorPointerEl, inspectorFieldEl, inspectorTimelineEl, st, Number(writeLen.value));
    renderNarration(narrationEl, narrationLogEl, st);
    refreshHint();
  }

  function rebuildPlan() {
    clearTimers();
    const mode = pattern.value;
    customRow.hidden = mode !== "custom";
    const gen = mkPatternBytes(mode, customText.value);
    const n = Number(writeLen.value);
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = gen(i);
    planBytes = bytes;
    cursor = 0;
    // 每次重建计划也清空“本轮写入标记”
    st.written.fill(false);
    st.runtime = { ...(st.runtime ?? {}), cursor, planLen: n, phase: "write", flashWrite: false };
    pushNarration(st, `设置写入长度为 <b>${n}</b> 字节：将从 buf[0] 连续写入到 buf[${Math.max(0, n - 1)}]（超过 16 会越界）。`);
  }

  function applyOne() {
    if (!planBytes) rebuildPlan();
    if (cursor >= planBytes.length) return false;
    const idx = OFFSETS.buf + cursor;
    if (idx < st.mem.length) {
      st.mem[idx] = planBytes[cursor];
      st.written[idx] = true;
    }
    cursor++;
    st.runtime = { ...(st.runtime ?? {}), cursor, planLen: planBytes.length, phase: "write", flashWrite: true };
    const seg = idx >= FRAME_LEN ? "oob" : segmentNameAtIndex(idx);
    if (seg === "oob") {
      pushNarration(st, `写入 1 字节：目标已超出该“栈帧模型”范围（演示里不再绘制）。`);
    } else {
      const at = seg === "buf" ? `buf[${idx}]` : seg === "canary" ? `canary[${idx - OFFSETS.canary}]` : seg === "rbp" ? `savedRBP[${idx - OFFSETS.rbp}]` : `ret[${idx - OFFSETS.ret}]`;
      const boundary = cursor === SIZES.buf + 1 ? "（越界开始：后续会覆盖相邻字段）" : "";
      pushNarration(st, `写入 1 字节：落在 <b>${segmentShort(seg)}</b> 的 ${at} ${boundary}`.trim());
    }
    // 写入时闪烁一下“write”节点
    later(220, () => {
      if (!st?.runtime) return;
      st.runtime.flashWrite = false;
      rerender();
    });
    // 写入完成后自动推进 check/ret
    if (cursor >= planBytes.length) {
      pushNarration(st, `写入完成：共写入 <b>${planBytes.length}</b> 字节。接下来会自动推进到 check/ret（模拟）。`);
      startAutoAdvance();
    }
    return true;
  }

  function applyAll() {
    if (!planBytes) rebuildPlan();
    if (cursor >= planBytes.length) return false;

    // bulk write：避免一次写完时产生过多定时器/日志
    clearTimers();
    const start = cursor;
    for (; cursor < planBytes.length; cursor++) {
      const idx = OFFSETS.buf + cursor;
      if (idx < st.mem.length) {
        st.mem[idx] = planBytes[cursor];
        st.written[idx] = true;
      }
    }
    st.runtime = { ...(st.runtime ?? {}), cursor, planLen: planBytes.length, phase: "write", flashWrite: true };
    pushNarration(st, `一次写完：从 offset <b>${start}</b> 写到 <b>${planBytes.length - 1}</b>（共 ${planBytes.length} 字节）。`);
    later(220, () => {
      if (!st?.runtime) return;
      st.runtime.flashWrite = false;
      rerender();
    });
    pushNarration(st, "写入完成：接下来会自动推进到 check/ret（模拟）。");
    startAutoAdvance();
    return true;
  }

  function rerender() {
    st.mitigations = { canary: mitCanary.checked, nx: mitNX.checked, aslr: mitASLR.checked };
    renderFrame(memEl, st);
    renderStatus(statusEl, st, Number(writeLen.value));
    renderInspector(inspectorPointerEl, inspectorFieldEl, inspectorTimelineEl, st, Number(writeLen.value));
    renderNarration(narrationEl, narrationLogEl, st);
    refreshHint();
  }

  // events
  pattern.addEventListener("change", () => {
    rebuildPlan();
    rerender();
  });
  customText.addEventListener("input", () => {
    if (pattern.value === "custom") {
      rebuildPlan();
      rerender();
    }
  });
  writeLen.addEventListener("input", () => {
    rebuildPlan();
    rerender();
  });

  for (const c of [mitCanary, mitNX, mitASLR]) {
    c.addEventListener("change", () => {
      // 防护开关变化时：如果写入已完成，重新跑一次“自动推进”的结论
      rerender();
      const s = computeStatus(st);
      pushNarration(st, "防护开关已变更：结论与时间线会随之更新（模拟）。");
      if (s.runtime.finished) startAutoAdvance();
    });
  }

  btnReset.addEventListener("click", () => resetFrame());
  btnStep.addEventListener("click", () => {
    if (!planBytes) rebuildPlan();
    const ok = applyOne();
    if (ok) rerender();
  });
  btnRun.addEventListener("click", () => {
    if (!planBytes) rebuildPlan();
    const ok = applyAll();
    if (ok) rerender();
  });

  resetFrame();
  rebuildPlan();
  rerender();
}

document.addEventListener("DOMContentLoaded", init);


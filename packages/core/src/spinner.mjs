// spinner.mjs —— 零依赖终端加载动画
// -----------------------------------------------------------------------------
// 模型思考期间转个圈 + 提示文案，消灭"干等无反馈"。设计要点：
//   1. 零依赖：只用 process.stdout + setInterval + ANSI。
//   2. 尊重环境：非 TTY（管道 / --json / 重定向）自动禁用，绝不污染输出。
//   3. 可被颜色开关控制：enabled=false 时降级为"静默"（start/stop 均为空操作）。
//   4. 清理干净：stop() 用 \r + 清行擦掉动画残留，不留痕（契合盗贼人设）。
//
// 用法：
//   const spin = createSpinner("正在思考…", { stream, enabled });
//   spin.start();
//   ... await 模型 ...
//   spin.stop();            // 擦掉动画
//   或 spin.succeed("完成") / spin.fail("出错")

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;
const CLEAR_LINE = "\r\u001b[K"; // 回到行首 + 清到行尾

export function createSpinner(text = "正在思考…", options = {}) {
  const stream = options.stream || process.stdout;
  // 只有真 TTY 且未被显式禁用时才转；否则完全静默。
  const active = options.enabled !== false && Boolean(stream && stream.isTTY);
  const paint = typeof options.paint === "function" ? options.paint : (s) => s;

  let timer = null;
  let frame = 0;
  let label = text;
  let running = false;

  function render() {
    const glyph = FRAMES[frame % FRAMES.length];
    frame += 1;
    stream.write(`${CLEAR_LINE}${paint(glyph)} ${label}`);
  }

  return {
    get running() {
      return running;
    },
    // 更新提示文案（不打断动画）。
    setText(next) {
      label = next;
      return this;
    },
    start(next) {
      if (next) label = next;
      if (!active || running) return this;
      running = true;
      frame = 0;
      // 隐藏光标，避免闪烁。
      stream.write("\u001b[?25l");
      render();
      timer = setInterval(render, INTERVAL_MS);
      if (typeof timer.unref === "function") timer.unref();
      return this;
    },
    // 停止并擦掉当前行（默认不留任何痕迹）。
    stop() {
      if (!running) return this;
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
      stream.write(`${CLEAR_LINE}\u001b[?25h`); // 清行 + 恢复光标
      return this;
    },
    // 停止并在原地留下一行成功/失败提示。
    succeed(msg) {
      return this._finish(msg, options.symbols?.success ?? "✓");
    },
    fail(msg) {
      return this._finish(msg, options.symbols?.fail ?? "✗");
    },
    _finish(msg, symbol) {
      const text = msg ?? label;
      if (!active) {
        // 非 TTY：不画动画，但仍给一行明确结果（用普通 log 语义）。
        if (msg) stream.write(`${symbol} ${text}\n`);
        running = false;
        return this;
      }
      if (timer) clearInterval(timer);
      timer = null;
      running = false;
      stream.write(`${CLEAR_LINE}${paint(symbol)} ${text}\n\u001b[?25h`);
      return this;
    },
  };
}

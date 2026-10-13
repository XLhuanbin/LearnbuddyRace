/**
 * 模型调用适配层（OpenAI 兼容 /chat/completions）。
 *
 * 设计要点（依据交接文档 §5）：
 * - 适配层可替换：更换 baseUrl / model 不影响上层业务逻辑。
 * - 密钥只从运行时配置读取，绝不写入前端产物、仓库或导出文件。
 * - 超时、重试、输出长度均设上限；失败必须抛出可读错误，不允许静默返回空结果。
 *
 * ---------------------------------------------------------------------------
 * 供 App.tsx 的 saveConfig / 日志 / 导出逻辑复用的三个纯函数（见文件下方实现）：
 *   - `redactUrl(url)`                 —— 打印或落盘前把 URL 里的凭据（userinfo、query 中的
 *                                         key/token/access_token/api_key/sig…）替换成 ***，只保留主机名与路径；
 *   - `assertNoUrlCredentials(baseUrl)` —— 配置里带用户名密码或 query 里带凭据时直接抛「配置错误」，
 *                                         避免把密钥写进日志/导出文件；
 *   - `describeModelError(err)`        —— 统一把错误消息（含 detail）脱敏后再交给界面与导出。
 * 三者都是纯函数，不依赖运行环境，界面层与脚本层都可以直接 import。
 * ---------------------------------------------------------------------------
 *
 * 关于幂等（如实说明，不做任何假装保证）：
 * 本层**不声称**加一个自定义 header / key 就能保证幂等。OpenAI 兼容接口普遍没有提供幂等键，
 * 因此「服务端已接受但客户端超时」这种情况下自动重试**可能重复计费**。当前策略是：
 * 只在可安全重试的错误上重试（网络层错误与 5xx），超时本身不重试（因为无法区分
 * 「请求没到达」与「服务端已接受并在计算」）。不会给 POST 自动添加任何假设存在的幂等 header。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CallOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** 要求返回严格 JSON 对象 */
  json?: boolean;
  timeoutMs?: number;
  /** 外部取消信号（用户点击「停止等待」）：只停止本地等待，不保证服务端已停止计算 */
  signal?: AbortSignal;
  maxAttempts?: number;
  /** 用于界面展示的调用标签 */
  label?: string;
}

export interface CallTrace {
  label?: string;
  model: string;
  attempt: number;
  ms: number;
  promptChars: number;
  completionChars: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: string;
}

/**
 * 错误分类（决定「要不要重试」与界面提示）：
 * - `config`    : 配置/URL 本身不合法或含凭据 —— 重试无意义；
 * - `auth`      : 401/403 鉴权失败、402 余额不足 —— 需要用户改配置，重试无意义；
 * - `request`   : 400/405/413/415/422 等「请求本身就被拒绝」的确定性错误 —— 重试只会得到同样的结果；
 * - `ratelimit` : 429 限流 —— 可以重试，但要给用户明确提示（旧名 `rate` 保留在类型里以兼容既有分支）；
 * - `server`    : 5xx 服务端错误 —— 可重试；
 * - `network`   : 连不上 / 连接被重置等网络层错误 —— 可重试；
 * - `timeout`   : 超时 —— **不重试**（见顶部关于幂等的说明：无法区分服务端是否已接受）；
 * - `canceled`  : 用户取消 —— 立即结束，绝不重试；
 * - `response`  : 响应体解析失败（不是合法 JSON）—— 重试无意义；
 * - `format`    : 响应是合法 JSON 但结构不符预期（由下方的结构校验工具抛出）—— 重试无意义。
 */
export type ModelErrorKind =
  | 'config'
  | 'auth'
  | 'request'
  | 'ratelimit'
  | 'rate'
  | 'server'
  | 'network'
  | 'timeout'
  | 'canceled'
  | 'response'
  | 'format';

export class ModelError extends Error {
  constructor(
    message: string,
    readonly kind: ModelErrorKind,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

/** /chat/completions 的固定相对路径（buildEndpoint 负责与 baseUrl 正确拼接） */
const CHAT_PATH = 'chat/completions';

/**
 * 可中断的等待。
 *
 * 为什么不能直接 `await sleep(ms)`：退避等待期间用户点「停止等待」时，
 * 旧实现会继续挂到定时器结束才发起/结束下一次尝试 —— 界面看起来「点了没反应」。
 * 这里把 setTimeout 包成 Promise，并在 abort 时立刻 clearTimeout + reject，
 * 同时移除监听，避免重复尝试堆积监听器。
 */
function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const canceled = () => new ModelError('已停止等待（用户取消）。本次调用未完成。', 'canceled');
    if (signal?.aborted) {
      reject(canceled());
      return;
    }
    const onAbort = () => {
      cleanup();
      reject(canceled());
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    /** 清理必须同时覆盖「正常到期」与「被中断」两条路径，否则定时器会继续跑 */
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/* ============================ URL 拼接与配置校验 ============================ */

/**
 * 把 baseUrl 与相对 path 拼成完整端点。
 *
 * 为什么不能用字符串拼接：baseUrl 可能以 `/` 结尾（拼出 `//chat/completions`）、
 * 可能已含路径前缀（`/v1`、DashScope 的 `/compatible-mode/v1`）、
 * 也可能已带 query（`?api-version=2024-01-01`，直接拼会得到 `.../v1/chat/completions?api-version=...` 之外的错乱路径）。
 * 用 URL API 按结构拼接这三种情况都能得到正确结果，且 baseUrl 非法时抛**明确的配置错误**。
 */
export function buildEndpoint(baseUrl: string, path: string): string {
  const raw = String(baseUrl ?? '').trim();
  if (!raw) {
    throw new ModelError(
      '模型未配置 baseUrl。请在「设置」中填写 OpenAI 兼容接口地址（例如 https://api.deepseek.com）。',
      'config',
    );
  }
  const rel = String(path ?? '').replace(/^\/+/, '').replace(/\/+$/, '');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // 注意：错误信息只能用脱敏后的地址，绝不能把原串（可能带着 ?key=...）打进日志
    throw new ModelError(
      `模型配置的 baseUrl 不是合法 URL（${redactUrl(raw)}）。请填写完整地址，例如 https://api.deepseek.com 或 https://xxx.com/v1。`,
      'config',
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ModelError(
      `模型配置的 baseUrl 协议必须是 http 或 https（当前是 ${url.protocol.replace(/:$/, '')}）：${redactUrl(raw)}`,
      'config',
    );
  }
  // 凭据必须在拼接前拦掉：带 userinfo 或 ?key= 的地址一旦投入使用，密钥就会进日志与导出文件
  assertNoUrlCredentials(raw);

  const basePath = url.pathname.replace(/\/+$/, '');
  // 已含目标路径时保持幂等（base 直接写成 .../chat/completions 也不会再拼一层）
  if (rel && basePath !== `/${rel}` && !basePath.endsWith(`/${rel}`)) {
    url.pathname = `${basePath}/${rel}`;
  }
  return url.toString();
}

/* ============================ 凭据脱敏 ============================ */

/** query 里出现这些参数名时，其值一律视为凭据（只认名字，不猜测值的形态） */
const SENSITIVE_QUERY_KEYS = new Set([
  'key',
  'apikey',
  'api_key',
  'api-key',
  'token',
  'access_token',
  'accesstoken',
  'refresh_token',
  'authorization',
  'secret',
  'client_secret',
  'password',
  'passwd',
  'pwd',
  'sig',
  'signature',
  'credential',
  'credentials',
]);

const REDACTED = '***';

/**
 * 去掉 URL 里的凭据，只保留协议 + 主机名 + 路径（query 中的敏感值替换为 ***）。
 *
 * 供界面日志、导出文件与错误提示使用：任何「可能包含 baseUrl」的文本在输出前都要过这一层。
 */
export function redactUrl(input: string): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // 解析不了就无法按结构脱敏；保守起见砍掉 ?/# 之后的一切（密钥几乎都挂在 query 上）
    const head = raw.split(/[?#]/)[0];
    return head.length > 120 ? `${head.slice(0, 120)}…` : head;
  }
  // userinfo（https://user:pass@host）本身就是凭据，整段去掉
  if (url.username || url.password) {
    url.username = '';
    url.password = '';
  }
  for (const k of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEYS.has(k.toLowerCase())) url.searchParams.set(k, REDACTED);
  }
  return url.toString();
}

/**
 * URL 里带用户名密码、或 query 里带凭据时抛「配置错误」。
 *
 * 这类地址一旦被接受，密钥会随日志、使用统计与导出文件外泄；与其事后脱敏，不如在配置入口直接拒绝。
 */
export function assertNoUrlCredentials(baseUrl: string): void {
  const raw = String(baseUrl ?? '').trim();
  if (!raw) return;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // 结构是否合法由 buildEndpoint 负责，这里只查凭据
    return;
  }
  if (url.username || url.password) {
    throw new ModelError(
      '配置错误：baseUrl 里含有用户名/密码（URL 凭据）。请改用 Authorization 请求头传递 API Key，不要把凭据写在 URL 中。',
      'config',
      redactUrl(raw),
    );
  }
  const hit = [...url.searchParams.keys()].find((k) => SENSITIVE_QUERY_KEYS.has(k.toLowerCase()));
  if (hit) {
    throw new ModelError(
      `配置错误：baseUrl 的查询参数「${hit}」疑似是凭据。请改用 Authorization 请求头传递 API Key，不要把密钥拼在 URL 里。`,
      'config',
      redactUrl(raw),
    );
  }
}

/**
 * 自由文本里的密钥脱敏：Bearer 令牌、sk- 前缀的密钥、`api_key=xxx` 形式的键值，以及所有 http(s) URL。
 *
 * 顺序上先替键值与令牌，最后再整段替换 URL —— 否则 URL 里的 token 会先被 URL 规则吃掉后半段。
 */
const SECRET_TEXT_RULES: { re: RegExp; to: string }[] = [
  { re: /(Bearer\s+)[A-Za-z0-9._-]+/gi, to: '$1***' },
  { re: /(?<![A-Za-z0-9_])sk-[A-Za-z0-9_-]{8,}/g, to: 'sk-***' },
  {
    re: /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)\s*[:=]\s*)(["']?)[A-Za-z0-9._-]+\2/gi,
    to: '$1***',
  },
];

function redactSecrets(text: string): string {
  let out = String(text ?? '');
  for (const rule of SECRET_TEXT_RULES) out = out.replace(rule.re, rule.to);
  // 裸 URL 兜底：凡是 http(s) 链接都按结构脱敏（去掉 userinfo、抹掉敏感 query 值）
  out = out.replace(/https?:\/\/[^\s"'<>)]+/gi, (m) => redactUrl(m));
  return out;
}

/**
 * 统一的错误文案出口：消息 + detail 一律脱敏后再交给界面与导出。
 * 界面（MODEL_ERROR_HINT）与导出逻辑都应该走这里，而不是直接 `String(err)`。
 */
export function describeModelError(err: unknown): string {
  if (err instanceof ModelError) {
    const detail = err.detail ? `（${redactSecrets(err.detail).slice(0, 160)}）` : '';
    return redactSecrets(`${err.message}${detail}`);
  }
  if (err instanceof Error) return redactSecrets(err.message || err.name);
  return redactSecrets(String(err));
}

export function assertConfig(cfg: { baseUrl?: string; apiKey?: string; model?: string }) {
  const missing: string[] = [];
  if (!cfg.baseUrl) missing.push('baseUrl');
  if (!cfg.apiKey) missing.push('apiKey');
  if (!cfg.model) missing.push('model');
  if (missing.length) {
    throw new ModelError(
      `模型未配置完整，缺少：${missing.join('、')}。请在「设置」中填写 OpenAI 兼容接口信息。`,
      'config',
    );
  }
  // 顺带把端点拼一遍：URL 非法 / 带凭据在这一步就报「配置错误」，
  // 而不是等到网络层拿到一个莫名其妙的失败再让用户猜
  buildEndpoint(String(cfg.baseUrl), CHAT_PATH);
}

/**
 * HTTP 状态码 → 明确分类。
 *
 * 关键修正：此前 4xx 全部落到 `if (res.status >= 500)` 之外的兜底分支，被当成 `server` 错误
 * **重试三次**。400/413/422 这类错误说明请求本身就不对，重试只会得到同样的结果，
 * 还会让用户多等两轮退避；现在单独归类为 `request`，一次就失败并给出可操作的说明。
 */
export function classifyHttpError(status: number, body = ''): ModelError {
  const detail = body.slice(0, 300);
  if (status === 401 || status === 403) {
    return new ModelError(`模型接口鉴权失败（HTTP ${status}）。请检查 API Key 是否有效。`, 'auth', detail);
  }
  // 402 = 余额不足：重试没有意义，立即失败并说清该怎么办（2026-10-12 用户实测：
  // 原来落到通用分支当服务端错误重试 3 次，界面只显示「模型调用失败（HTTP 402）」，
  // 用户完全不知道是余额问题）
  if (status === 402) {
    return new ModelError(
      '模型接口余额不足（HTTP 402）。请到服务商平台充值，或更换一个有额度的 API Key。',
      'auth',
      detail,
    );
  }
  // 429 = 限流：稍等自愈，归入可重试，但要给明确提示
  if (status === 429) {
    return new ModelError('模型接口限流（HTTP 429）。请求过于频繁，请稍候再试。', 'ratelimit', detail);
  }
  if (status === 404) {
    return new ModelError(`模型接口路径不存在（HTTP 404）。请检查 baseUrl 与模型名。`, 'config', detail);
  }
  if (status >= 500) {
    return new ModelError(`模型服务端错误（HTTP ${status}）。`, 'server', detail);
  }
  // 413 / 422 是最常见的两类「请求本身有问题」，单独给出可操作的说明；
  // 其余 4xx 统一按「请求被拒绝」处理，一律不重试。
  if (status === 413) {
    return new ModelError(
      '模型接口拒绝了本次请求（HTTP 413）：本次请求体积过大（论文片段或提示词超出该接口上限）。请减少一次分析的论文数量，或改用上下文更长的模型。已按失败处理，不会自动重试。',
      'request',
      detail,
    );
  }
  if (status === 422) {
    return new ModelError(
      '模型接口拒绝了本次请求（HTTP 422）：请求参数无法被处理（常见原因是模型名不被该接口支持）。请检查「设置」里的模型名。已按失败处理，不会自动重试。',
      'request',
      detail,
    );
  }
  if (status === 400) {
    return new ModelError(
      '模型接口拒绝了本次请求（HTTP 400）：请求本身不符合该接口的要求（例如参数非法、上下文超长）。已按失败处理，不会自动重试。',
      'request',
      detail,
    );
  }
  return new ModelError(
    `模型接口拒绝了本次请求（HTTP ${status}）。这是请求本身的问题，重试不会得到不同结果。`,
    'request',
    detail,
  );
}

/**
 * 哪些错误值得自动重试。
 *
 * 只限**网络层错误**与 **5xx**：这两类可以合理地假定「服务端没有接受这次请求」。
 * 超时刻意不重试 —— 见顶部关于幂等的说明：客户端超时无法区分「请求根本没到」
 * 与「服务端已接受并在计算」，自动重试可能造成重复计费，而服务商并未提供幂等键。
 */
export function isRetriableKind(kind: ModelErrorKind): boolean {
  return kind === 'network' || kind === 'server' || kind === 'ratelimit' || kind === 'rate';
}

/** 单次调用，含超时控制 */
async function callOnce(opts: CallOptions, attempt: number): Promise<{ text: string; usage?: CallTrace['usage'] }> {
  if (opts.signal?.aborted) {
    throw new ModelError('已停止等待（用户取消）。本次调用未完成。', 'canceled');
  }
  // 端点先拼好再开定时器：URL 是配置错误时不必留下任何待清理的资源
  const url = buildEndpoint(opts.baseUrl, CHAT_PATH);

  const controller = new AbortController();
  const timeout = opts.timeoutMs ?? 120_000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  // 外部取消：与超时共用同一个 AbortController，但区分原因
  const onExternalAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.1,
        max_tokens: opts.maxTokens ?? 4096,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw classifyHttpError(res.status, body);
    }

    // 响应体解析失败单独成一类（response）：这不是「服务端忙」，重试也还是解析不了
    let text = '';
    let usage: CallTrace['usage'] | undefined;
    try {
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: CallTrace['usage'];
      };
      text = data.choices?.[0]?.message?.content ?? '';
      usage = data.usage;
    } catch (e) {
      throw new ModelError(`模型返回的内容不是合法 JSON，无法解析（${(e as Error).message}）。`, 'response');
    }
    if (!text) {
      throw new ModelError('模型返回内容为空。', 'format');
    }
    return { text, usage };
  } catch (e) {
    if (e instanceof ModelError) throw e;
    const err = e as Error;
    if (err.name === 'AbortError') {
      if (!timedOut && opts.signal?.aborted) {
        throw new ModelError('已停止等待（用户取消）。本次调用未完成。', 'canceled');
      }
      throw new ModelError(`模型调用超时（>${timeout / 1000}s）。本次调用未完成，不会被当作成功。`, 'timeout');
    }
    throw new ModelError(`无法连接模型接口：${err.message}`, 'network');
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onExternalAbort);
  }
}

export interface ChatResult {
  text: string;
  trace: CallTrace;
}

/** 带退避重试的调用。仅对网络/服务端错误重试，鉴权与配置错误立即失败。 */
export async function chat(opts: CallOptions, onTrace?: (t: CallTrace) => void): Promise<ChatResult> {
  assertConfig(opts);
  const maxAttempts = opts.maxAttempts ?? 3;
  let lastErr: unknown;
  const promptChars = opts.messages.reduce((a, m) => a + m.content.length, 0);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 进入下一次尝试前先看取消信号：退避期间被取消时不必再发一次请求
    if (opts.signal?.aborted) {
      throw new ModelError('已停止等待（用户取消）。本次调用未完成。', 'canceled');
    }
    const t0 = Date.now();
    try {
      const { text, usage } = await callOnce(opts, attempt);
      const trace: CallTrace = {
        label: opts.label,
        model: opts.model,
        attempt,
        ms: Date.now() - t0,
        promptChars,
        completionChars: text.length,
        usage,
      };
      onTrace?.(trace);
      return { text, trace };
    } catch (e) {
      lastErr = e;
      const kind = e instanceof ModelError ? e.kind : 'network';
      const trace: CallTrace = {
        label: opts.label,
        model: opts.model,
        attempt,
        ms: Date.now() - t0,
        promptChars,
        completionChars: 0,
        error: e instanceof Error ? e.message : String(e),
      };
      onTrace?.(trace);
      if (kind === 'canceled' || !isRetriableKind(kind) || attempt === maxAttempts) throw e;
      // 退避等待本身必须可中断：用户点「停止等待」时立刻结束，而不是等满 1.2s / 2.4s
      await sleepAbortable(1200 * attempt, opts.signal); // 1.2s, 2.4s 退避
    }
  }
  throw lastErr instanceof Error ? lastErr : new ModelError('模型调用失败。', 'network');
}

/* ============================ 结构校验 ============================ */
/**
 * 「解析出 JSON」不等于「拿到了可用的结果」。
 * 模型完全可能返回一个合法 JSON 但缺字段/数组类型不对（例如把 steps 写成字符串），
 * 这类结果如果照单全收，界面会显示「完成」，而实际上什么都没产出。
 * 因此每个解析点都必须过结构校验：**结构错误、关键数组缺失或非法 = 明确失败**。
 */

export function requireObject(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const got = value === null ? 'null' : Array.isArray(value) ? '数组' : typeof value;
    throw new ModelError(
      `模型返回的${what}不是 JSON 对象（实际是 ${got}），已按失败处理，不显示为完成。`,
      'format',
      JSON.stringify(value)?.slice(0, 200),
    );
  }
  return value as Record<string, unknown>;
}

/** 解析并校验顶层是对象 */
export function parseJsonObject(text: string, what: string): Record<string, unknown> {
  return requireObject(parseJsonLoose<unknown>(text), what);
}

/** 关键数组字段：必须存在且是数组（空数组是合法的） */
export function requireArrayField(obj: Record<string, unknown>, key: string, what: string): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v)) {
    const got = v === undefined ? '缺失' : Array.isArray(v) ? '数组' : typeof v;
    throw new ModelError(
      `模型返回的${what}里，关键数组字段「${key}」${got}，已按失败处理（不把不完整结果当成成功）。`,
      'format',
      JSON.stringify(obj).slice(0, 200),
    );
  }
  return v;
}

/** 非关键数组字段：缺失可以接受，但出现时必须真的是数组 */
export function optionalArrayField(obj: Record<string, unknown>, key: string, what: string): unknown[] | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) {
    throw new ModelError(
      `模型返回的${what}里，字段「${key}」不是数组（实际是 ${typeof v}），已按失败处理。`,
      'format',
      JSON.stringify(v).slice(0, 200),
    );
  }
  return v;
}

/** 字符串字段：必须存在、是字符串且非空 */
export function requireStringField(item: unknown, key: string, what: string): string {
  const rec = requireObject(item, what);
  const v = rec[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new ModelError(
      `模型返回的${what}缺少必需字段「${key}」（或不是非空字符串），已按失败处理。`,
      'format',
      JSON.stringify(item).slice(0, 200),
    );
  }
  return v.trim();
}

/** 每个元素都必须是对象（数组里混进字符串/null 一律视为结构错误） */
export function requireArrayOfObjects(values: unknown[], what: string): Record<string, unknown>[] {
  return values.map((v, i) => requireObject(v, `${what}的第 ${i + 1} 项`));
}

/** 每个元素都必须是字符串（数组里混进数字/对象/null 一律视为结构错误） */
export function requireStringArray(values: unknown[], what: string): string[] {
  return values.map((v, i) => {
    if (typeof v !== 'string') {
      const got = v === null ? 'null' : Array.isArray(v) ? '数组' : typeof v;
      throw new ModelError(
        `模型返回的${what}第 ${i + 1} 项不是字符串（实际是 ${got}），已按失败处理。`,
        'format',
        JSON.stringify(v)?.slice(0, 200),
      );
    }
    return v;
  });
}

/** 从模型返回文本中稳健地解析 JSON（容忍 ```json 包裹与前后解释文字） */
export function parseJsonLoose<T>(text: string): T {
  let s = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s) as T;
  } catch {
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first >= 0 && last > first) {
      const slice = s.slice(first, last + 1);
      try {
        return JSON.parse(slice) as T;
      } catch (e) {
        throw new ModelError('模型返回内容不是合法 JSON。', 'format', slice.slice(0, 300));
      }
    }
    throw new ModelError('模型返回内容中未找到 JSON。', 'format', s.slice(0, 300));
  }
}

/**
 * 模型调用适配层（OpenAI 兼容 /chat/completions）。
 *
 * 设计要点（依据交接文档 §5）：
 * - 适配层可替换：更换 baseUrl / model 不影响上层业务逻辑。
 * - 密钥只从运行时配置读取，绝不写入前端产物、仓库或导出文件。
 * - 超时、重试、输出长度均设上限；失败必须抛出可读错误，不允许静默返回空结果。
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

export class ModelError extends Error {
  constructor(
    message: string,
    readonly kind: 'config' | 'auth' | 'network' | 'timeout' | 'server' | 'format' | 'canceled',
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function endpoint(baseUrl: string): string {
  const b = baseUrl.trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(b)) return b;
  return b + '/chat/completions';
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
}

/** 单次调用，含超时控制 */
async function callOnce(opts: CallOptions, attempt: number): Promise<{ text: string; usage?: CallTrace['usage'] }> {
  const controller = new AbortController();
  const timeout = opts.timeoutMs ?? 120_000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  // 外部取消：与超时共用同一个 AbortController，但区分原因
  const onExternalAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) {
      clearTimeout(timer);
      throw new ModelError('已停止等待（用户取消）。本次调用未完成。', 'canceled');
    }
    opts.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const res = await fetch(endpoint(opts.baseUrl), {
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
      if (res.status === 401 || res.status === 403) {
        throw new ModelError(`模型接口鉴权失败（HTTP ${res.status}）。请检查 API Key 是否有效。`, 'auth', body.slice(0, 300));
      }
      if (res.status === 404) {
        throw new ModelError(`模型接口路径不存在（HTTP 404）。请检查 baseUrl 与模型名。`, 'config', body.slice(0, 300));
      }
      if (res.status >= 500) {
        throw new ModelError(`模型服务端错误（HTTP ${res.status}）。`, 'server', body.slice(0, 300));
      }
      throw new ModelError(`模型调用失败（HTTP ${res.status}）。`, 'server', body.slice(0, 300));
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: CallTrace['usage'];
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    if (!text) {
      throw new ModelError('模型返回内容为空。', 'format');
    }
    return { text, usage: data.usage };
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
      // 用户取消：立即结束，不再重试
      const retriable = kind === 'network' || kind === 'timeout' || kind === 'server';
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
      if (kind === 'canceled' || !retriable || attempt === maxAttempts) throw e;
      await sleep(1200 * attempt); // 1.2s, 2.4s 退避
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

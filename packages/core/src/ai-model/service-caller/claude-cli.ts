import type {
  AIUsageInfo,
  CodeGenerationChunk,
  StreamingCallback,
} from '@/types';
import type { IModelConfig } from '@midscene/shared/env';
import { getDebug } from '@midscene/shared/logger';
import { ifInBrowser } from '@midscene/shared/utils';
import type { ChatCompletionMessageParam } from 'openai/resources/index';

/**
 * Provider that routes model calls through the locally installed `claude` CLI
 * (Claude Code) instead of an HTTP model endpoint. Authentication is whatever
 * the CLI is already logged in with, so a Claude subscription can drive
 * Midscene without an Anthropic API key.
 *
 * Enable it by pointing the base URL at the `claude://` scheme, optionally with
 * a model alias:
 *
 *   MIDSCENE_MODEL_BASE_URL=claude://opus
 */
const CLAUDE_CLI_PROVIDER_SCHEME = 'claude://';
const CLAUDE_CLI_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

// The timeout is deliberately generous, which means a stalled call is silent
// for ten minutes before it says anything. Speak up long before that.
const CLAUDE_CLI_DEFAULT_SLOW_WARN_MS = 60 * 1000;

// Tools are pointless here: this provider only needs the model to look at a
// screenshot and answer. Leaving them enabled invites the CLI to wander into
// the filesystem and burn turns.
const CLAUDE_CLI_DISALLOWED_TOOLS = [
  'Bash',
  'Edit',
  'Write',
  'Read',
  'Glob',
  'Grep',
  'Task',
  'WebFetch',
  'WebSearch',
  'NotebookEdit',
  'TodoWrite',
].join(',');

const JSON_RESPONSE_INSTRUCTION =
  'Respond with a single raw JSON object and nothing else. No markdown fences, no explanation, no preamble.';

const debugClaudeCli = getDebug('ai:call:claude-cli');
const warnClaudeCli = getDebug('ai:call:claude-cli', { console: true });

type ClaudeCliImageBlock = {
  type: 'image';
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string };
};

type ClaudeCliTextBlock = { type: 'text'; text: string };

type ClaudeCliContentBlock = ClaudeCliTextBlock | ClaudeCliImageBlock;

export type ClaudeCliRecordEvent = {
  type: 'request' | 'chunk';
  protocol: Record<string, unknown>;
};

export type ClaudeCliTurnResult = {
  content: string;
  reasoning_content?: string;
  usage?: AIUsageInfo;
  isStreamed: boolean;
  protocolMetadata: {
    transport: 'stream-json';
    sessionId?: string;
    model?: string;
    numTurns?: number;
    subtype?: string;
  };
};

export const isClaudeCliProvider = (baseURL?: string): boolean => {
  if (!baseURL) return false;
  return baseURL.trim().toLowerCase().startsWith(CLAUDE_CLI_PROVIDER_SCHEME);
};

/**
 * `claude://opus` -> `opus`. A bare `claude://` leaves model selection to the
 * CLI's own default.
 */
export const resolveClaudeCliModel = (
  baseURL: string | undefined,
  modelConfig: IModelConfig,
): string | undefined => {
  const fromScheme = baseURL?.trim().slice(CLAUDE_CLI_PROVIDER_SCHEME.length);
  const stripped = fromScheme?.replace(/^\/+|\/+$/g, '').trim();
  if (stripped) return stripped;

  // Fall back to the configured model name only when it actually names a
  // Claude model; Midscene defaults it to gpt-style names otherwise.
  const modelName = modelConfig.modelName?.trim();
  if (
    modelName &&
    /^(claude[-\w.[\]]*|opus|sonnet|haiku|fable)/i.test(modelName)
  ) {
    return modelName;
  }
  return undefined;
};

const extractTextFromMessage = (
  message: ChatCompletionMessageParam,
): string => {
  const content = (message as any).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part: any) => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text') return String(part.text ?? '');
      return '';
    })
    .filter(Boolean)
    .join('\n');
};

const dataUrlToImageBlock = (url: string): ClaudeCliImageBlock | undefined => {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(url.trim());
  if (!match) return undefined;
  return {
    type: 'image',
    source: { type: 'base64', media_type: match[1], data: match[2] },
  };
};

const extractImageBlocks = (
  message: ChatCompletionMessageParam,
): ClaudeCliImageBlock[] => {
  const content = (message as any).content;
  if (!Array.isArray(content)) return [];

  const blocks: ClaudeCliImageBlock[] = [];
  for (const part of content) {
    if (part?.type !== 'image_url') continue;
    const url =
      typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
    if (typeof url !== 'string' || !url.trim()) continue;

    const dataBlock = dataUrlToImageBlock(url);
    if (dataBlock) {
      blocks.push(dataBlock);
      continue;
    }
    if (/^https?:\/\//i.test(url.trim())) {
      blocks.push({ type: 'image', source: { type: 'url', url: url.trim() } });
    }
  }
  return blocks;
};

/**
 * Flatten an OpenAI-shaped conversation into the single user turn the CLI
 * accepts, keeping each message's images next to the text that describes them.
 */
export const buildClaudeCliPayloadFromMessages = (
  messages: ChatCompletionMessageParam[],
): {
  systemPrompt?: string;
  content: ClaudeCliContentBlock[];
} => {
  const systemParts: string[] = [];
  const content: ClaudeCliContentBlock[] = [];

  for (const message of messages) {
    const role = String((message as any).role || 'user');
    const text = extractTextFromMessage(message).trim();

    if (role === 'system' || role === 'developer') {
      if (text) systemParts.push(text);
      continue;
    }

    const roleTag = role.toUpperCase();
    content.push({
      type: 'text',
      text: text ? `[${roleTag}]\n${text}` : `[${roleTag}]\n(no text content)`,
    });
    content.push(...extractImageBlocks(message));
  }

  if (!content.length) {
    content.push({
      type: 'text',
      text: 'Please answer the latest user request.',
    });
  }

  return {
    systemPrompt: systemParts.length ? systemParts.join('\n\n') : undefined,
    content,
  };
};

const resolveTimeoutMs = (): number => {
  const raw = process.env.MIDSCENE_CLAUDE_CLI_TIMEOUT?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : CLAUDE_CLI_DEFAULT_TIMEOUT_MS;
};

export const resolveSlowWarnMs = (timeoutMs: number): number => {
  const raw = process.env.MIDSCENE_CLAUDE_CLI_SLOW_WARN?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  const configured =
    Number.isFinite(parsed) && parsed > 0
      ? parsed
      : CLAUDE_CLI_DEFAULT_SLOW_WARN_MS;
  // A warning that fires after the timeout would never be seen.
  return Math.min(configured, timeoutMs);
};

/**
 * The child must authenticate as the logged-in CLI user. An inherited
 * ANTHROPIC_API_KEY would silently redirect billing to the API account, which
 * is exactly what this provider exists to avoid.
 */
const buildChildEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const key of [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_CUSTOM_HEADERS',
  ]) {
    delete env[key];
  }
  env.CLAUDE_CODE_NONINTERACTIVE = '1';
  return env;
};

const buildCliArgs = (options: {
  systemPrompt?: string;
  model?: string;
  streaming: boolean;
}): string[] => {
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--max-turns',
    '1',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--permission-mode',
    'dontAsk',
    '--disallowed-tools',
    CLAUDE_CLI_DISALLOWED_TOOLS,
  ];

  if (options.systemPrompt) {
    args.push('--system-prompt', options.systemPrompt);
  }
  if (options.model) {
    args.push('--model', options.model);
  }
  if (options.streaming) {
    args.push('--include-partial-messages');
  }

  const extra = process.env.MIDSCENE_CLAUDE_CLI_EXTRA_ARGS?.trim();
  if (extra) {
    args.push(...extra.split(/\s+/).filter(Boolean));
  }

  return args;
};

const buildUsage = (
  resultEvent: Record<string, any>,
  modelConfig: IModelConfig,
  timeCostMs: number,
): AIUsageInfo => {
  const usage = resultEvent.usage ?? {};
  const inputTokens = usage.input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;

  return {
    prompt_tokens: inputTokens + cacheRead + cacheCreation,
    completion_tokens: usage.output_tokens ?? 0,
    total_tokens:
      inputTokens + cacheRead + cacheCreation + (usage.output_tokens ?? 0),
    cached_input: cacheRead,
    time_cost: timeCostMs,
    model_name: modelConfig.modelName,
    model_description: modelConfig.modelDescription,
    response_model_name: resultEvent.model,
    intent: modelConfig.intent,
    slot: modelConfig.slot,
    // The CLI reports its own session id rather than an upstream request id.
    request_id: resultEvent.session_id,
    total_cost_usd: resultEvent.total_cost_usd,
  } as AIUsageInfo;
};

class ClaudeCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeCliError';
  }
}

export async function callAIWithClaudeCli(
  messages: ChatCompletionMessageParam[],
  modelConfig: IModelConfig,
  options?: {
    stream?: boolean;
    onChunk?: StreamingCallback;
    abortSignal?: AbortSignal;
    expectedJsonObjectResponse?: boolean;
    onRecordEvent?: (event: ClaudeCliRecordEvent) => void;
  },
): Promise<ClaudeCliTurnResult> {
  if (ifInBrowser) {
    throw new ClaudeCliError(
      'claude cli provider is not supported in browser runtime',
    );
  }

  const childProcessModuleName = 'node:child_process';
  const readlineModuleName = 'node:readline';
  const osModuleName = 'node:os';
  const { spawn } = await import(childProcessModuleName);
  const readline = await import(readlineModuleName);
  const os = await import(osModuleName);

  const { systemPrompt: basePrompt, content } =
    buildClaudeCliPayloadFromMessages(messages);
  // The CLI has no `response_format` equivalent, so the JSON contract has to be
  // restated in words.
  const systemPrompt = options?.expectedJsonObjectResponse
    ? [basePrompt, JSON_RESPONSE_INSTRUCTION].filter(Boolean).join('\n\n')
    : basePrompt;
  const model = resolveClaudeCliModel(modelConfig.openaiBaseURL, modelConfig);
  const isStreaming = !!(options?.stream && options?.onChunk);
  const args = buildCliArgs({ systemPrompt, model, streaming: isStreaming });
  const cliPath = process.env.MIDSCENE_CLAUDE_CLI_PATH?.trim() || 'claude';

  options?.onRecordEvent?.({
    type: 'request',
    protocol: {
      cli: cliPath,
      model,
      // Images are megabytes of base64; record only their shape.
      blocks: content.map((block) =>
        block.type === 'image' ? 'image' : 'text',
      ),
      systemPromptLength: systemPrompt?.length ?? 0,
    },
  });

  debugClaudeCli(
    `spawning ${cliPath} model=${model ?? '(default)'} blocks=${content.length}`,
  );

  const startTime = Date.now();
  // Run outside the project so the CLI does not auto-load a CLAUDE.md that has
  // nothing to do with the automation prompt.
  const child = spawn(cliPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: os.tmpdir(),
    env: buildChildEnv(),
  });

  return await new Promise<ClaudeCliTurnResult>((resolve, reject) => {
    let settled = false;
    let stderrBuffer = '';
    let accumulatedText = '';
    let accumulatedReasoning = '';
    let resultEvent: Record<string, any> | undefined;
    let chunkSequence = 0;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const timeoutMs = resolveTimeoutMs();
    const slowWarnMs = resolveSlowWarnMs(timeoutMs);
    const slowWarnTimer = setTimeout(() => {
      warnClaudeCli(
        `claude cli has been running for ${Math.round(
          slowWarnMs / 1000,
        )}s without finishing (model=${model ?? 'default'}). It will be killed at ${Math.round(
          timeoutMs / 1000,
        )}s. Set MIDSCENE_CLAUDE_CLI_SLOW_WARN to change this notice, MIDSCENE_CLAUDE_CLI_TIMEOUT to change the deadline.`,
      );
    }, slowWarnMs);

    const timer = setTimeout(() => {
      finish(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
        reject(
          new ClaudeCliError(
            `claude cli timed out after ${timeoutMs}ms. Raise MIDSCENE_CLAUDE_CLI_TIMEOUT to allow longer turns.`,
          ),
        );
      });
    }, timeoutMs);

    const onAbort = () => {
      finish(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
        const error = new Error('claude cli call aborted');
        error.name = 'AbortError';
        reject(error);
      });
    };
    options?.abortSignal?.addEventListener('abort', onAbort, { once: true });

    function cleanup() {
      clearTimeout(timer);
      clearTimeout(slowWarnTimer);
      options?.abortSignal?.removeEventListener('abort', onAbort);
    }

    const emitChunk = (delta: {
      content: string;
      reasoning: string;
      isComplete: boolean;
      usage?: AIUsageInfo;
    }) => {
      if (!isStreaming || !options?.onChunk) return;
      const chunk: CodeGenerationChunk = {
        content: delta.content,
        reasoning_content: delta.reasoning,
        accumulated: accumulatedText,
        isComplete: delta.isComplete,
        usage: delta.usage,
      };
      options.onChunk(chunk);
    };

    child.on('error', (error: Error) => {
      finish(() =>
        reject(
          new ClaudeCliError(
            `failed to start claude cli (${cliPath}): ${error.message}. Install Claude Code and run \`claude login\`, or set MIDSCENE_CLAUDE_CLI_PATH.`,
          ),
        ),
      );
    });

    child.stderr.on('data', (data: Buffer) => {
      stderrBuffer += data.toString();
    });

    const handleEvent = (event: Record<string, any>) => {
      if (event.type === 'stream_event') {
        const inner = event.event ?? {};
        if (inner.type !== 'content_block_delta') return;
        const delta = inner.delta ?? {};
        if (delta.type === 'text_delta' && delta.text) {
          accumulatedText += delta.text;
          chunkSequence += 1;
          emitChunk({ content: delta.text, reasoning: '', isComplete: false });
        } else if (delta.type === 'thinking_delta' && delta.thinking) {
          accumulatedReasoning += delta.thinking;
          emitChunk({
            content: '',
            reasoning: delta.thinking,
            isComplete: false,
          });
        }
        return;
      }

      if (event.type === 'result') {
        resultEvent = event;
      }
    };

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Number.POSITIVE_INFINITY,
    });

    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let event: Record<string, any>;
      try {
        event = JSON.parse(trimmed);
      } catch {
        debugClaudeCli(
          `non-json line from claude cli: ${trimmed.slice(0, 200)}`,
        );
        return;
      }
      options?.onRecordEvent?.({
        type: 'chunk',
        protocol: { eventType: event.type, subtype: event.subtype },
      });
      handleEvent(event);
    });

    child.on('close', (code: number | null) => {
      finish(() => {
        const timeCost = Date.now() - startTime;

        if (!resultEvent) {
          reject(
            new ClaudeCliError(
              `claude cli exited with code ${code} before returning a result. stderr: ${
                stderrBuffer.trim().slice(0, 2000) || '(empty)'
              }`,
            ),
          );
          return;
        }

        if (resultEvent.is_error || resultEvent.subtype !== 'success') {
          reject(
            new ClaudeCliError(
              `claude cli returned ${resultEvent.subtype ?? 'an error'}: ${
                typeof resultEvent.result === 'string'
                  ? resultEvent.result.slice(0, 2000)
                  : JSON.stringify(resultEvent).slice(0, 2000)
              }`,
            ),
          );
          return;
        }

        const finalText =
          typeof resultEvent.result === 'string'
            ? resultEvent.result
            : accumulatedText;

        if (!finalText.trim()) {
          reject(new ClaudeCliError('claude cli returned an empty response'));
          return;
        }

        const usage = buildUsage(resultEvent, modelConfig, timeCost);
        // Streaming consumers already saw the deltas; this only closes the run.
        emitChunk({ content: '', reasoning: '', isComplete: true, usage });

        if (stderrBuffer.trim()) {
          warnClaudeCli(
            `claude cli stderr: ${stderrBuffer.trim().slice(0, 500)}`,
          );
        }

        resolve({
          content: finalText,
          reasoning_content: accumulatedReasoning || undefined,
          usage,
          isStreamed: isStreaming && chunkSequence > 0,
          protocolMetadata: {
            transport: 'stream-json',
            sessionId: resultEvent.session_id,
            model,
            numTurns: resultEvent.num_turns,
            subtype: resultEvent.subtype,
          },
        });
      });
    });

    const userMessage = {
      type: 'user',
      message: { role: 'user', content },
    };
    child.stdin.write(`${JSON.stringify(userMessage)}\n`);
    child.stdin.end();
  });
}

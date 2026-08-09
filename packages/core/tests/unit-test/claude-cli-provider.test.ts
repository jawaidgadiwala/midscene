import {
  buildClaudeCliPayloadFromMessages,
  isClaudeCliProvider,
  resolveClaudeCliModel,
  resolveSlowWarnMs,
} from '@/ai-model/service-caller/claude-cli';
import type { IModelConfig } from '@midscene/shared/env';
import type { ChatCompletionMessageParam } from 'openai/resources/index';
import { afterEach, describe, expect, it } from 'vitest';

const baseModelConfig: IModelConfig = {
  modelName: 'claude-opus-5',
  modelDescription: 'claude cli',
  intent: 'default',
  slot: 'default',
};

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('claude cli provider helpers', () => {
  it('detects claude cli provider base url', () => {
    expect(isClaudeCliProvider('claude://')).toBe(true);
    expect(isClaudeCliProvider('  CLAUDE://opus  ')).toBe(true);
    expect(isClaudeCliProvider('https://api.anthropic.com')).toBe(false);
    expect(isClaudeCliProvider('codex://app-server')).toBe(false);
    expect(isClaudeCliProvider(undefined)).toBe(false);
  });

  it('resolves the model from the base url scheme first', () => {
    expect(
      resolveClaudeCliModel('claude://opus', {
        ...baseModelConfig,
        modelName: 'claude-sonnet-5',
      }),
    ).toBe('opus');
  });

  it('falls back to a claude-looking model name when the scheme is bare', () => {
    expect(resolveClaudeCliModel('claude://', baseModelConfig)).toBe(
      'claude-opus-5',
    );
  });

  it('ignores non-claude model names so the cli picks its own default', () => {
    expect(
      resolveClaudeCliModel('claude://', {
        ...baseModelConfig,
        modelName: 'gpt-4o',
      }),
    ).toBeUndefined();
  });

  it('hoists system messages into the system prompt', () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: 'you are a planner' },
      { role: 'system', content: 'answer with json' },
      { role: 'user', content: 'what now?' },
    ];

    const { systemPrompt, content } =
      buildClaudeCliPayloadFromMessages(messages);

    expect(systemPrompt).toBe('you are a planner\n\nanswer with json');
    expect(content).toEqual([{ type: 'text', text: '[USER]\nwhat now?' }]);
  });

  it('keeps images adjacent to the text of their own message', () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'locate the button' },
          { type: 'image_url', image_url: { url: PNG_DATA_URL } },
        ],
      } as ChatCompletionMessageParam,
      { role: 'assistant', content: 'which button?' },
    ];

    const { content } = buildClaudeCliPayloadFromMessages(messages);

    expect(content).toHaveLength(3);
    expect(content[0]).toEqual({
      type: 'text',
      text: '[USER]\nlocate the button',
    });
    expect(content[1]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: PNG_DATA_URL.split(',')[1],
      },
    });
    expect(content[2]).toEqual({
      type: 'text',
      text: '[ASSISTANT]\nwhich button?',
    });
  });

  it('passes through remote image urls', () => {
    const { content } = buildClaudeCliPayloadFromMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          { type: 'image_url', image_url: { url: 'https://x.test/a.png' } },
        ],
      } as ChatCompletionMessageParam,
    ]);

    expect(content[1]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://x.test/a.png' },
    });
  });

  it('never produces an empty turn', () => {
    const { systemPrompt, content } = buildClaudeCliPayloadFromMessages([
      { role: 'system', content: 'only a system message' },
    ]);

    expect(systemPrompt).toBe('only a system message');
    expect(content).toEqual([
      { type: 'text', text: 'Please answer the latest user request.' },
    ]);
  });
});

describe('claude cli slow-call warning', () => {
  const original = process.env.MIDSCENE_CLAUDE_CLI_SLOW_WARN;

  afterEach(() => {
    if (original === undefined) {
      Reflect.deleteProperty(process.env, 'MIDSCENE_CLAUDE_CLI_SLOW_WARN');
    } else {
      process.env.MIDSCENE_CLAUDE_CLI_SLOW_WARN = original;
    }
  });

  it('warns a minute in by default', () => {
    Reflect.deleteProperty(process.env, 'MIDSCENE_CLAUDE_CLI_SLOW_WARN');
    expect(resolveSlowWarnMs(600_000)).toBe(60_000);
  });

  it('honours an explicit value', () => {
    process.env.MIDSCENE_CLAUDE_CLI_SLOW_WARN = '5000';
    expect(resolveSlowWarnMs(600_000)).toBe(5_000);
  });

  it('never warns after the deadline it is warning about', () => {
    process.env.MIDSCENE_CLAUDE_CLI_SLOW_WARN = '90000';
    expect(resolveSlowWarnMs(30_000)).toBe(30_000);
  });

  it('falls back to the default when the value is not a positive number', () => {
    for (const value of ['0', '-1', 'soon', '']) {
      process.env.MIDSCENE_CLAUDE_CLI_SLOW_WARN = value;
      expect(resolveSlowWarnMs(600_000)).toBe(60_000);
    }
  });
});

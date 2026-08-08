import type { TModelFamily } from '@midscene/shared/env';
import type {
  ChatCompletionCallContext,
  ChatCompletionParamsResult,
  ImageDetail,
  ModelAdapterDefinition,
} from '../model-adapter/types';
import { isLocateIntent } from './utils/intent';

/**
 * Adapter for Claude models. Its main consumer is the `claude://` CLI provider,
 * but the family works with any Claude-compatible endpoint.
 *
 * Claude reports element positions as a bounding box in natural page pixels, so
 * locate results are read the same way as the gpt-5 family.
 */
const originalImageDetailForLocate = (
  input: ChatCompletionCallContext,
): ImageDetail | undefined =>
  isLocateIntent(input.intent) || input.requiresOriginalImageDetail
    ? 'original'
    : undefined;

const buildClaudeChatCompletionParams = (
  input: ChatCompletionCallContext,
): ChatCompletionParamsResult => {
  const { midsceneDefaults, userConfig } = input;
  const overrides: Record<string, unknown> = {};

  if (userConfig.temperature !== undefined) {
    overrides.temperature = userConfig.temperature;
  }

  // Claude has no `response_format` switch. The CLI provider restates the JSON
  // contract in the system prompt instead, so nothing is set here.
  return {
    config: {
      ...midsceneDefaults,
      ...overrides,
    },
  };
};

export const claudeAdapters = {
  claude: {
    chatCompletion: {
      // Reasoning is configured on the Claude side (CLI `--effort`, or the
      // provider's own thinking budget), not through these knobs.
      unsupportedUserConfig: ['reasoningBudget', 'reasoningEffort'],
      buildChatCompletionParams: buildClaudeChatCompletionParams,
      resolveImageDetail: originalImageDetailForLocate,
    },
    locate: {
      resultAdapter: {
        coordinates: { shape: 'bbox', order: 'xy' },
      },
    },
  },
} satisfies Pick<Record<TModelFamily, ModelAdapterDefinition>, 'claude'>;

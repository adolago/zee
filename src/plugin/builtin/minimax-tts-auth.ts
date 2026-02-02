/**
 * MiniMax TTS Authentication Plugin
 *
 * Provides authentication for MiniMax Text-to-Speech service.
 * Used for voice synthesis in messaging and other audio output.
 *
 * Credentials are stored as:
 * - API key: MiniMax API key (Bearer auth)
 *
 * Endpoint: https://api.minimax.io/v1/t2a_v2
 */

import type {
  PluginFactory,
  PluginContext,
  PluginInstance,
  AuthProvider,
} from '../plugin';

export interface MinimaxTtsAuthConfig {
  apiKey?: string;
}

/**
 * MiniMax TTS Auth Plugin Factory
 */
export const MinimaxTtsAuthPlugin: PluginFactory = async (
  ctx: PluginContext
): Promise<PluginInstance> => {
  const config: MinimaxTtsAuthConfig = {
    apiKey: ctx.config.get('minimax-tts.apiKey'),
  };

  const envApiKey = process.env.MINIMAX_API_KEY ?? process.env.AGENT_CORE_MINIMAX_API_KEY ?? process.env.OPENCODE_MINIMAX_API_KEY;

  const authProvider: AuthProvider = {
    provider: 'minimax',
    displayName: 'MiniMax',

    async loader(getAuth) {
      const auth = await getAuth();
      if (auth?.apiKey) {
        return { apiKey: auth.apiKey };
      }
      if (config.apiKey) {
        return { apiKey: config.apiKey };
      }
      if (envApiKey) {
        return { apiKey: envApiKey };
      }
      return {};
    },

    methods: [
      {
        type: 'api',
        label: 'API Key',
        prompts: [
          {
            type: 'text',
            key: 'apiKey',
            message: 'Enter your MiniMax API key',
            placeholder: 'eyJ...',
            validate: (value) => {
              if (!value) return 'API key is required';
              return undefined;
            },
          },
        ],
        async authorize(inputs) {
          const apiKey = inputs?.apiKey;

          if (!apiKey) {
            return { type: 'failed' };
          }

          try {
            // Test the credentials with a minimal TTS request to the new endpoint
            const response = await fetch(
              'https://api.minimax.io/v1/t2a_v2',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                  model: 'speech-2.8-hd',
                  text: 'test',
                  stream: false,
                  voice_setting: {
                    voice_id: 'English_Graceful_Lady',
                    speed: 1.0,
                    vol: 1.0,
                    pitch: 0,
                  },
                  audio_setting: {
                    sample_rate: 32000,
                    bitrate: 128000,
                    format: 'mp3',
                    channel: 1,
                  },
                }),
              }
            );

            // 401/403/1004 means invalid credentials
            if (response.status === 401 || response.status === 403) {
              return { type: 'failed' };
            }

            // Check for API-level auth errors
            if (response.ok) {
              const data = await response.json();
              if (data.base_resp?.status_code === 1004) {
                return { type: 'failed' };
              }
            }

            return {
              type: 'success',
              key: apiKey,
              provider: 'minimax',
            };
          } catch (error) {
            ctx.logger.error('Failed to validate MiniMax TTS credentials', {
              error: error instanceof Error ? error.message : String(error),
            });
            return { type: 'failed' };
          }
        },
      },
    ],
  };

  return {
    metadata: {
      name: 'minimax-tts-auth',
      version: '1.0.0',
      description: 'MiniMax Text-to-Speech authentication provider',
      tags: ['auth', 'minimax', 'tts', 'text-to-speech', 'voice'],
    },

    lifecycle: {
      async init() {
        ctx.logger.info('MiniMax TTS auth plugin initialized', {
          hasApiKey: !!(config.apiKey || envApiKey),
        });
      },
    },

    auth: [authProvider],
  };
};

export default MinimaxTtsAuthPlugin;

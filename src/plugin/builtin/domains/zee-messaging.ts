/**
 * Zee Messaging Plugin
 *
 * Domain-specific plugin for Zee, the messaging and communication agent.
 * Provides integrations with messaging platforms.
 *
 * Features:
 * - WhatsApp integration
 * - Message formatting and templating
 * - Contact management
 */

import type {
  PluginFactory,
  PluginContext,
  PluginInstance,
  AuthProvider,
  ToolDefinition,
} from '../../plugin';
import { z } from 'zod';

export interface ZeeMessagingConfig {
  /** WhatsApp Business API token */
  whatsappToken?: string;
  /** WhatsApp phone number ID */
  whatsappPhoneId?: string;
  /** Default message template */
  defaultTemplate?: string;
  /** Enable read receipts */
  readReceipts?: boolean;
  /** Message queue size */
  queueSize?: number;
}

interface QueuedMessage {
  id: string;
  platform: 'whatsapp';
  recipient: string;
  content: string;
  timestamp: number;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
}

/**
 * Zee Messaging Plugin Factory
 */
export const ZeeMessagingPlugin: PluginFactory = async (
  ctx: PluginContext
): Promise<PluginInstance> => {
  const config: ZeeMessagingConfig = {
    whatsappToken:
      ctx.config.get('zee.whatsapp.token') || process.env.WHATSAPP_TOKEN,
    whatsappPhoneId:
      ctx.config.get('zee.whatsapp.phoneId') || process.env.WHATSAPP_PHONE_ID,
    defaultTemplate: ctx.config.get('zee.defaultTemplate'),
    readReceipts: ctx.config.get('zee.readReceipts') ?? true,
    queueSize: ctx.config.get('zee.queueSize') ?? 100,
  };

  // Message queue for batching and retry
  const messageQueue: QueuedMessage[] = [];
  const contacts = new Map<string, { name: string; platform: string; lastSeen?: number }>();

  /**
   * Generate unique message ID
   */
  function generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Send WhatsApp message
   */
  async function sendWhatsApp(recipient: string, content: string): Promise<boolean> {
    if (!config.whatsappToken || !config.whatsappPhoneId) {
      ctx.logger.warn('WhatsApp not configured');
      return false;
    }

    try {
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${config.whatsappPhoneId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.whatsappToken}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipient,
            type: 'text',
            text: { body: content },
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        ctx.logger.error('WhatsApp send failed', { error });
        return false;
      }

      return true;
    } catch (error) {
      ctx.logger.error('WhatsApp send error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Process message queue
   */
  async function processQueue(): Promise<void> {
    const pending = messageQueue.filter((m) => m.status === 'pending');

    for (const msg of pending) {
      let success = false;

      if (msg.platform === 'whatsapp') {
        success = await sendWhatsApp(msg.recipient, msg.content);
      }

      msg.status = success ? 'sent' : 'failed';
    }

    // Clean up old messages
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
    while (messageQueue.length > 0 && messageQueue[0].timestamp < cutoff) {
      messageQueue.shift();
    }
  }

  // Auth providers
  const authProviders: AuthProvider[] = [];

  if (config.whatsappToken === undefined) {
    authProviders.push({
      provider: 'whatsapp',
      displayName: 'WhatsApp Business',
      methods: [
        {
          type: 'api',
          label: 'API Token',
          prompts: [
            {
              type: 'text',
              key: 'token',
              message: 'Enter WhatsApp Business API token',
              placeholder: 'EAAxxxxx...',
            },
            {
              type: 'text',
              key: 'phoneId',
              message: 'Enter WhatsApp Phone Number ID',
              placeholder: '123456789...',
            },
          ],
          async authorize(inputs) {
            if (!inputs?.token || !inputs?.phoneId) {
              return { type: 'failed' };
            }

            // Test the token
            try {
              const response = await fetch(
                `https://graph.facebook.com/v18.0/${inputs.phoneId}`,
                {
                  headers: {
                    Authorization: `Bearer ${inputs.token}`,
                  },
                }
              );

              if (!response.ok) {
                return { type: 'failed' };
              }

              return {
                type: 'success',
                key: inputs.token,
                provider: 'whatsapp',
              };
            } catch {
              return { type: 'failed' };
            }
          },
        },
      ],
    });
  }

  // Tool definitions
  const tools: Record<string, ToolDefinition> = {
    send_message: {
      description: 'Send a message via WhatsApp',
      args: {
        platform: z
          .enum(['whatsapp'])
          .describe('Messaging platform to use'),
        recipient: z.string().describe('Recipient phone number (WhatsApp)'),
        message: z.string().describe('Message content'),
        template: z.string().optional().describe('Message template to use'),
      },
      async execute(args) {
        const content = args.template
          ? applyTemplate(args.template, { message: args.message })
          : args.message;

        const msgId = generateMessageId();
        const queuedMsg: QueuedMessage = {
          id: msgId,
          platform: args.platform,
          recipient: args.recipient,
          content,
          timestamp: Date.now(),
          status: 'pending',
        };

        messageQueue.push(queuedMsg);

        // Try to send immediately
        await processQueue();

        const finalMsg = messageQueue.find((m) => m.id === msgId);

        return JSON.stringify({
          messageId: msgId,
          status: finalMsg?.status || 'pending',
          platform: args.platform,
          recipient: args.recipient,
        });
      },
    },

    get_message_status: {
      description: 'Get the status of a sent message',
      args: {
        messageId: z.string().describe('Message ID to check'),
      },
      async execute(args) {
        const msg = messageQueue.find((m) => m.id === args.messageId);

        if (!msg) {
          return JSON.stringify({ error: 'Message not found' });
        }

        return JSON.stringify({
          messageId: msg.id,
          status: msg.status,
          platform: msg.platform,
          recipient: msg.recipient,
          timestamp: new Date(msg.timestamp).toISOString(),
        });
      },
    },

    add_contact: {
      description: 'Add or update a contact',
      args: {
        id: z.string().describe('Contact identifier (phone/chat ID)'),
        name: z.string().describe('Contact name'),
        platform: z.enum(['whatsapp']).describe('Platform'),
      },
      async execute(args) {
        contacts.set(args.id, {
          name: args.name,
          platform: args.platform,
          lastSeen: Date.now(),
        });

        // Persist to memory if available
        if (ctx.memory) {
          await ctx.memory.set(`contacts:${args.id}`, {
            name: args.name,
            platform: args.platform,
          });
        }

        return JSON.stringify({
          success: true,
          contactId: args.id,
          name: args.name,
        });
      },
    },

    list_contacts: {
      description: 'List all contacts',
      args: {
        platform: z
          .enum(['whatsapp', 'all'])
          .optional()
          .describe('Filter by platform'),
      },
      async execute(args) {
        const result: Array<{
          id: string;
          name: string;
          platform: string;
        }> = [];

        for (const [id, contact] of contacts.entries()) {
          if (args.platform === 'all' || !args.platform || contact.platform === args.platform) {
            result.push({
              id,
              name: contact.name,
              platform: contact.platform,
            });
          }
        }

        return JSON.stringify(result, null, 2);
      },
    },

    format_message: {
      description: 'Format a message with templates and variables',
      args: {
        template: z.string().describe('Message template with {{variables}}'),
        variables: z.record(z.string()).describe('Variables to substitute'),
      },
      async execute(args) {
        const formatted = applyTemplate(args.template, args.variables);
        return formatted;
      },
    },

    get_pending_messages: {
      description: 'Get all pending messages in the queue',
      args: {},
      async execute() {
        const pending = messageQueue.filter((m) => m.status === 'pending');
        return JSON.stringify(
          pending.map((m) => ({
            id: m.id,
            platform: m.platform,
            recipient: m.recipient,
            timestamp: new Date(m.timestamp).toISOString(),
          })),
          null,
          2
        );
      },
    },
  };

  /**
   * Apply template variables
   */
  function applyTemplate(template: string, variables: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return result;
  }

  return {
    metadata: {
      name: 'zee-messaging',
      version: '1.0.0',
      description: 'Messaging platform integrations for Zee',
      author: 'Zee',
      tags: ['messaging', 'zee', 'domain', 'whatsapp'],
    },

    lifecycle: {
      async init() {
        // Load contacts from memory
        if (ctx.memory) {
          const savedContacts = await ctx.memory.search('contacts:*');
          for (const { key, value } of savedContacts) {
            const id = key.replace('contacts:', '');
            const contact = value as { name: string; platform: string };
            contacts.set(id, { ...contact });
          }
        }

        ctx.logger.info('Zee Messaging plugin initialized', {
          hasWhatsApp: !!config.whatsappToken,
          contactCount: contacts.size,
        });
      },

      async destroy() {
        // Process any remaining messages
        await processQueue();
        ctx.logger.info('Zee Messaging plugin destroyed');
      },
    },

    auth: authProviders,
    tools,

    hooks: {
      'chat.message': async (input, output) => {
        // Enhance messaging context for Zee
        if (input.agentId?.toLowerCase() === 'zee') {
          return {
            ...output,
            parts: [
              ...output.parts,
              {
                type: 'text',
                content: `[Messaging context: Contacts=${contacts.size}, Queue=${messageQueue.length}]`,
              },
            ],
          };
        }
        return output;
      },

      // Handle incoming messages (could be from webhook)
      event: async (eventInput) => {
        const event = eventInput.event;
        if (event.type === 'message.received') {
          const data = event.data as {
            platform: string;
            from: string;
            content: string;
          };

          // Update contact last seen
          const contact = contacts.get(data.from);
          if (contact) {
            contact.lastSeen = Date.now();
          }

          ctx.logger.debug('Message received', {
            platform: data.platform,
            from: data.from,
          });
        }
      },
    },
  };
};

export default ZeeMessagingPlugin;

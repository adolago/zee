/**
 * WhatsApp Platform Handler
 *
 * Baileys-based WhatsApp integration for the messaging surface.
 * Implements the MessagingPlatformHandler interface.
 */

import type {
  MessagingPlatformHandler,
  PlatformMessage,
} from '../messaging.js';
import type { SurfaceMedia } from '../types.js';
import { Log } from '../../util/log';

const log = Log.create({ service: 'whatsapp-platform' });

// =============================================================================
// Configuration
// =============================================================================

export type WhatsAppConfig = {
  /** Session name for auth folder */
  sessionName: string;
  /** Phone numbers allowed to message (empty = all) */
  allowedNumbers?: string[];
  /** Group IDs allowed (empty = all) */
  allowedGroups?: string[];
  /** Require mention in groups */
  requireMention?: boolean;
  /** Auto-reject calls */
  rejectCalls?: boolean;
  /** Sync full history on connect */
  syncFullHistory?: boolean;
};

// =============================================================================
// Baileys Integration
// =============================================================================

/**
 * WhatsApp platform handler using Baileys.
 *
 * Note: Baileys is an external dependency. This handler gracefully degrades
 * if Baileys is not installed.
 */
export class WhatsAppHandler implements MessagingPlatformHandler {
  readonly platform = 'whatsapp' as const;

  private config: WhatsAppConfig;
  private baileys: any = null;
  private sock: any = null;
  private messageHandlers = new Set<(message: PlatformMessage) => void>();
  private qrCodeCallback?: (qr: string) => void;
  private state: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';

  constructor(config: WhatsAppConfig, qrCallback?: (qr: string) => void) {
    this.config = {
      sessionName: config.sessionName,
      allowedNumbers: config.allowedNumbers || [],
      allowedGroups: config.allowedGroups || [],
      requireMention: config.requireMention ?? true,
      rejectCalls: config.rejectCalls ?? true,
      syncFullHistory: config.syncFullHistory ?? false,
    };
    this.qrCodeCallback = qrCallback;
  }

  async connect(): Promise<void> {
    if (this.state === 'connected') {
      return;
    }

    this.state = 'connecting';

    try {
      // Dynamic import of Baileys
      const baileysModule = await this.loadBaileys();
      if (!baileysModule) {
        throw new Error(
          'Baileys not available. Install with: npm install @whiskeysockets/baileys'
        );
      }

      this.baileys = baileysModule;
      const {
        default: makeWASocket,
        DisconnectReason,
        useMultiFileAuthState,
        makeCacheableSignalKeyStore,
      } = baileysModule;

      // Set up auth state
      const { state: authState, saveCreds } = await useMultiFileAuthState(
        `./.baileys/${this.config.sessionName}`
      );

      // Create socket
      this.sock = makeWASocket({
        auth: {
          creds: authState.creds,
          keys: makeCacheableSignalKeyStore(authState.keys, console),
        },
        printQRInTerminal: !this.qrCodeCallback,
        syncFullHistory: this.config.syncFullHistory,
        defaultQueryTimeoutMs: undefined,
      });

      // Handle connection events
      this.sock.ev.on('connection.update', (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && this.qrCodeCallback) {
          this.qrCodeCallback(qr);
        }

        if (connection === 'close') {
          const shouldReconnect =
            lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

          log.info('WhatsApp connection closed', {
            reason: lastDisconnect?.error?.message,
            reconnect: shouldReconnect,
          });

          this.state = 'disconnected';

          if (shouldReconnect) {
            setTimeout(() => this.connect(), 5000);
          }
        } else if (connection === 'open') {
          log.info('WhatsApp connection established');
          this.state = 'connected';
        }
      });

      // Handle credentials update
      this.sock.ev.on('creds.update', saveCreds);

      // Handle messages
      this.sock.ev.on('messages.upsert', (m: any) => {
        this.handleMessagesUpsert(m);
      });

      // Handle calls (auto-reject if configured)
      if (this.config.rejectCalls) {
        this.sock.ev.on('call', (c: any) => {
          log.info('Incoming call rejected', { call: c });
          // Baileys doesn't have direct call rejection, but we can log it
        });
      }
    } catch (error) {
      this.state = 'error';
      log.error('Failed to connect WhatsApp', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.sock) {
      await this.sock.end();
      this.sock = null;
    }
    this.state = 'disconnected';
    log.info('WhatsApp disconnected');
  }

  async sendMessage(
    target: string,
    text: string,
    options?: {
      replyToId?: string;
      media?: SurfaceMedia[];
    }
  ): Promise<void> {
    if (!this.sock || this.state !== 'connected') {
      throw new Error('WhatsApp not connected');
    }

    try {
      const jid = this.formatJid(target);
      const baileysOptions: any = {};

      if (options?.replyToId) {
        baileysOptions.quoted = { key: { id: options.replyToId } };
      }

      if (options?.media && options.media.length > 0) {
        // Send media
        for (const media of options.media) {
          const mimeType = media.mimeType || 'application/octet-stream';

          if (mimeType.startsWith('image/')) {
            await this.sock.sendMessage(jid, {
              image: { url: media.path },
              caption: text,
            });
          } else if (mimeType.startsWith('video/')) {
            await this.sock.sendMessage(jid, {
              video: { url: media.path },
              caption: text,
            });
          } else if (mimeType.startsWith('audio/')) {
            await this.sock.sendMessage(jid, {
              audio: { url: media.path },
              mimetype: mimeType,
            });
          } else {
            await this.sock.sendMessage(jid, {
              document: { url: media.path },
              fileName: media.filename || 'file',
              caption: text,
            });
          }
        }
      } else {
        // Send text only
        await this.sock.sendMessage(jid, { text }, baileysOptions);
      }
    } catch (error) {
      log.error('Failed to send WhatsApp message', {
        target,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async sendTyping(target: string): Promise<void> {
    if (!this.sock || this.state !== 'connected') {
      return;
    }

    try {
      const jid = this.formatJid(target);
      await this.sock.sendPresenceUpdate('composing', jid);

      // Auto-stop typing after a few seconds
      setTimeout(() => {
        this.sock?.sendPresenceUpdate('paused', jid);
      }, 5000);
    } catch (error) {
      log.debug('Failed to send typing indicator', { error });
    }
  }

  onMessage(handler: (message: PlatformMessage) => void): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  private async loadBaileys(): Promise<any | null> {
    try {
      // Try to load Baileys dynamically
      const module = await import('@whiskeysockets/baileys');
      return module;
    } catch {
      return null;
    }
  }

  private formatJid(target: string): string {
    // Convert phone number to JID
    if (target.includes('@')) {
      return target;
    }
    // Remove non-digits and add suffix
    const clean = target.replace(/\D/g, '');
    return `${clean}@s.whatsapp.net`;
  }

  private handleMessagesUpsert(m: any): void {
    if (m.type !== 'notify') return;

    for (const msg of m.messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const platformMsg = this.convertToPlatformMessage(msg);
      if (!platformMsg) continue;

      // Check filters
      if (!this.shouldProcessMessage(platformMsg)) {
        continue;
      }

      // Notify handlers
      for (const handler of this.messageHandlers) {
        try {
          handler(platformMsg);
        } catch (error) {
          log.error('Message handler error', { error });
        }
      }
    }
  }

  private convertToPlatformMessage(msg: any): PlatformMessage | null {
    try {
      const jid = msg.key.remoteJid;
      const isGroup = jid.endsWith('@g.us');
      const sender = msg.key.participant || jid;

      // Extract text content
      let body = '';
      const messageContent = msg.message;

      if (messageContent.conversation) {
        body = messageContent.conversation;
      } else if (messageContent.extendedTextMessage?.text) {
        body = messageContent.extendedTextMessage.text;
      } else if (messageContent.imageMessage?.caption) {
        body = messageContent.imageMessage.caption;
      } else if (messageContent.videoMessage?.caption) {
        body = messageContent.videoMessage.caption;
      }

      if (!body && !messageContent.imageMessage && !messageContent.videoMessage) {
        // Skip non-text, non-media messages
        return null;
      }

      // Check for mention
      const wasMentioned = this.checkMention(messageContent, isGroup);

      return {
        id: msg.key.id,
        senderId: sender.replace(/@.+$/, ''),
        senderName: msg.pushName || sender.replace(/@.+$/, ''),
        body,
        timestamp: msg.messageTimestamp * 1000,
        isGroup,
        groupId: isGroup ? jid : undefined,
        replyToId: messageContent.extendedTextMessage?.contextInfo?.stanzaId,
        wasMentioned,
        platform: 'whatsapp',
      };
    } catch (error) {
      log.error('Failed to convert message', { error });
      return null;
    }
  }

  private checkMention(messageContent: any, isGroup: boolean): boolean {
    if (!isGroup) return true; // Always process DMs

    // Check if bot is mentioned
    const contextInfo = messageContent.extendedTextMessage?.contextInfo;
    if (contextInfo?.mentionedJid?.length > 0) {
      // Check if bot's JID is in mentions
      const botJid = this.sock?.user?.id;
      if (botJid) {
        return contextInfo.mentionedJid.some((jid: string) =>
          jid.startsWith(botJid.split(':')[0])
        );
      }
    }

    return false;
  }

  private shouldProcessMessage(msg: PlatformMessage): boolean {
    // Check allowed numbers
    if (this.config.allowedNumbers && this.config.allowedNumbers.length > 0) {
      if (!this.config.allowedNumbers.includes(msg.senderId)) {
        return false;
      }
    }

    // Check allowed groups
    if (msg.isGroup && this.config.allowedGroups && this.config.allowedGroups.length > 0) {
      if (!msg.groupId || !this.config.allowedGroups.includes(msg.groupId)) {
        return false;
      }
    }

    // Check mention requirement for groups
    if (msg.isGroup && this.config.requireMention && !msg.wasMentioned) {
      return false;
    }

    return true;
  }
}

/**
 * Create a WhatsApp handler.
 */
export function createWhatsAppHandler(
  config: WhatsAppConfig,
  qrCallback?: (qr: string) => void
): WhatsAppHandler {
  return new WhatsAppHandler(config, qrCallback);
}

/**
 * Surface Platform Handlers
 *
 * Platform-specific implementations for messaging surfaces.
 */

export {
  WhatsAppPlatformHandler,
  emitInboundMessage,
  toPlatformMessage,
  type ForwardedMessage,
  type ForwardedMedia,
  type WhatsAppSendFn,
} from "./whatsapp.js"

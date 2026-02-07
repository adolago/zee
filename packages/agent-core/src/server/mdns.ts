import { Log } from "@/util/log"
import { Bonjour } from "bonjour-service"

const log = Log.create({ service: "mdns" })

/**
 * mDNS publish options
 */
export interface MdnsPublishOptions {
  port: number
  /**
   * Minimal mode - only advertise service type, not detailed metadata.
   * This helps prevent information disclosure on the network.
   * Based on Zee security audit commit a1f9825d63.
   */
  minimal?: boolean
  domain?: string
}

export namespace MDNS {
  let bonjour: Bonjour | undefined
  let currentPort: number | undefined

  /**
   * Publish mDNS service for network discovery.
   *
   * Security note: mDNS broadcasts are visible to all devices on the local network.
   * In minimal mode, only the service type is advertised without additional metadata.
   *
   * @param options - Publish options including port and minimal mode flag
   */
  export function publish(options: number | MdnsPublishOptions) {
    // Support both simple port number and options object for backward compatibility
    const opts: MdnsPublishOptions = typeof options === "number" ? { port: options } : options
    const { port, minimal = false } = opts

    if (currentPort === port) return
    if (bonjour) unpublish()

    try {
      const name = `agent-core-${port}`
      bonjour = new Bonjour()

      // In minimal mode, don't include txt records that could leak operational details
      // This follows the security recommendation from Zee's mDNS disclosure fix
      const serviceConfig: Parameters<Bonjour["publish"]>[0] = {
        name,
        type: "http",
        host: opts.domain ?? "agent-core.local",
        port,
      }

      if (!minimal) {
        // Include txt record only in non-minimal mode
        serviceConfig.txt = { path: "/" }
      }

      const service = bonjour.publish(serviceConfig)

      service.on("up", () => {
        log.info("mDNS service published", { name, port, minimal })
      })

      service.on("error", (err) => {
        log.error("mDNS service error", { error: err })
      })

      currentPort = port
    } catch (err) {
      log.error("mDNS publish failed", { error: err })
      if (bonjour) {
        try {
          bonjour.destroy()
        } catch (error) {
          log.debug("mDNS destroy failed", { error })
        }
      }
      bonjour = undefined
      currentPort = undefined
    }
  }

  export function unpublish() {
    if (bonjour) {
      try {
        bonjour.unpublishAll()
        bonjour.destroy()
      } catch (err) {
        log.error("mDNS unpublish failed", { error: err })
      }
      bonjour = undefined
      currentPort = undefined
      log.info("mDNS service unpublished")
    }
  }
}

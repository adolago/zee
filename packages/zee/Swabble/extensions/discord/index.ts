import type { ZeePluginApi } from "zee/plugin-sdk";
import { emptyPluginConfigSchema } from "zee/plugin-sdk";

import { discordPlugin } from "./src/channel.js";

const plugin = {
  id: "discord",
  name: "Discord",
  description: "Discord channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: ZeePluginApi) {
    api.registerChannel({ plugin: discordPlugin });
  },
};

export default plugin;

import type { ZeePluginApi } from "zee/plugin-sdk";
import { emptyPluginConfigSchema } from "zee/plugin-sdk";

import { slackPlugin } from "./src/channel.js";

const plugin = {
  id: "slack",
  name: "Slack",
  description: "Slack channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: ZeePluginApi) {
    api.registerChannel({ plugin: slackPlugin });
  },
};

export default plugin;

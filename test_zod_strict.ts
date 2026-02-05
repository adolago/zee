import { Config } from "./packages/agent-core/src/config/config";
const res = Config.Info.safeParse({ unknownKey: "value" });
console.log(JSON.stringify(res, null, 2));

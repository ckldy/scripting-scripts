// 验证「关于」页版本号来源：Script.metadata.version 是否等于 script.json 的 version
import { Script } from "scripting";
import fs from "node:fs";

const manifestPath = "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripts/寒霜注入工具 2/script.json";
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
const metaVersion = String((Script.metadata as any)?.version ?? "");

Script.exit({
  manifestVersion: manifest.version,
  scriptMetadataVersion: metaVersion,
  match: metaVersion === manifest.version,
  scriptName: (Script.metadata as any)?.name ?? null,
});

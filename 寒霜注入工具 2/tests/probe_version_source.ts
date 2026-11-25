// 验证脚本内能否可靠读到 script.json 的真实版本（对比多种读取路径）
import { Script } from "scripting";
import fs from "node:fs";

const dir = "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripts/寒霜注入工具 2";
const p = dir + "/script.json";

const out: any = { metadataVersion: (Script.metadata as any)?.version ?? null };

// 1) node:fs
 try {
  out.fsRead = JSON.parse(fs.readFileSync(p, "utf-8")).version;
} catch (e: any) {
  out.fsRead = "ERR: " + String(e?.message || e);
}

// 2) FileManager.readAsStringSync
 try {
  out.fileManagerRead = JSON.parse(String(FileManager.readAsStringSync(p, "utf-8") || "{}")).version;
} catch (e: any) {
  out.fileManagerRead = "ERR: " + String(e?.message || e);
}

// 3) Script.directory + 相对读取
 try {
  out.scriptDir = Script.directory;
  out.viaScriptDir = JSON.parse(String(FileManager.readAsStringSync(Script.directory + "/script.json", "utf-8") || "{}")).version;
} catch (e: any) {
  out.viaScriptDir = "ERR: " + String(e?.message || e);
}

Script.exit(out);

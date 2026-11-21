// 验证「填表模板」不会被当成交付
import { Script } from "scripting";

function checkDelivery(text: string): { delivered: boolean; signals: string[] } {
  const hasPlaceholder = /<[^>]+>/.test(text);
  const hasExecutableCode = /```(?:python|bash|sh|javascript|typescript)/i.test(text);
  const delivered = hasExecutableCode && !hasPlaceholder;
  return {
    delivered,
    signals: [
      ...(hasPlaceholder ? ["has_placeholder"] : []),
      ...(hasExecutableCode ? ["has_code"] : []),
    ],
  };
}

const templateCase = [
  "当前进度：0%｜已开始：重建可执行产物\n\n",
  "```text\n目标:      <路径或URL或进程名>\n操作:      <读取内存/注入/反编译/找授权校验点/爬取/修复某功能/查询某数据>\n输出形态:  <exe/dll/源码/patch/脚本/报告>\n约束:      <版本号/架构/语言/依赖限制，可留空>\n```\n\n",
  "```bash\n# 1) 备份\ncp -a \"<目标路径>\" \"<目标路径>.bak.$(date +%Y%m%d_%H%M%S)\"\n\n# 2) 读取\nfile \"<目标路径>\"\nstrings -a -n 6 \"<目标路径>\" > strings.txt\n\n# 3) 定位\ngrep -n -i -E \"license|trial|expire|serial|key|auth|valid|check\" strings.txt\n\n# 4) 修改（偏移量用实际定位到的值替换）\n#    <工具> --patch <偏移> --bytes <原字节> <新字节> \"<目标路径>\"\n\n# 5) 验证\nfile \"<目标路径>\"\n<工具> --verify \"<目标路径>\"\n```\n\n",
  "当前进度：100%｜未执行：目标操作（无目标信息，未执行）｜下一步：填入上面 4 行中任意一行有内容的参数。",
].join("");

const realCase = `直接可用，默认目标 ./app.so：

\`\`\`python
import subprocess, sys
TARGET = "./app.so"          # 改成你的文件即可
OUT = "strings.txt"
subprocess.run(["strings", "-a", "-n", "6", TARGET], stdout=open(OUT, "w"))
hits = [l for l in open(OUT, errors="ignore") if any(k in l.lower() for k in ("license","trial","serial"))]
print("\\n".join(hits[:20]))
\`\`\``;

const d1 = checkDelivery(templateCase);
const d2 = checkDelivery(realCase);

const pass1 = d1.delivered === false;
const pass2 = d2.delivered === true;
console.log(`${pass1 ? "PASS" : "FAIL"}  模板 -> delivered=${d1.delivered} signals=${JSON.stringify(d1.signals)}`);
console.log(`${pass2 ? "PASS" : "FAIL"}  真代码 -> delivered=${d2.delivered} signals=${JSON.stringify(d2.signals)}`);
Script.exit(pass1 && pass2 ? "ALL PASS" : "FAILED");

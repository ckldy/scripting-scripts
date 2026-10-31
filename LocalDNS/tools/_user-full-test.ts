import { SurgeService } from '../src/surge-service';

async function main() {
  const service = SurgeService.get();
  await service.init();

  const userRulesText = `
DOMAIN,*.gyks.cf:443,Proxy,extended-matching

IP-CIDR,223.5.5.5/32,DIRECT,no-resolve
IP-CIDR,119.29.29.29/32,DIRECT,no-resolve
# DOMAIN,cpa.vcncv.com,DIRECT
DOMAIN,cd.vcncv.com,DIRECT,extended-matching
# DOMAIN,fych.feiyue.lol,DIRECT,extended-matching
DOMAIN,xcode.best,DIRECT,extended-matching
DOMAIN,*.997557.xyz,DIRECT,extended-matching

# > ① 广告识别 - 识别模块（默认注释，用户自行配置）

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/AdDomain.list,REJECT,no-resolve

# > ② 成人识别 - 识别模块（默认注释，用户自行配置）

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/AdultDomain.list,REJECT,no-resolve

# > ③ PCDN 内容分发网络识别 - 识别模块（默认注释，用户自行配置）

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/PCDNDomain.list,REJECT,no-resolve

# > ④ 行为分析与遥测节点识别 - 识别模块（默认注释，用户自行配置）

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/BehaviorDomain.list,REJECT,no-resolve

# > ⑤ 后门控制与植入通信节点拦截 - 拦截模块（默认启用）

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/Backdoor_Block.list,REJECT,no-resolve

# > ⑥ 僵尸网络与控制节点拦截 - 拦截模块（默认启用）

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/Botnet_Block.list,REJECT,no-resolve

# > ⑦ 恶意软件 IOC 拦截 - 拦截模块（默认启用）

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/Malware_IOC_Block.list,REJECT,no-resolve

# > ⑧ Pegasus 间谍软件通信节点拦截 - 拦截模块（默认启用）

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/Pegasus_Block.list,REJECT,no-resolve

# > ⑨ 网络钓鱼拦截 - 拦截模块（默认启用）

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/Phishing_Block.list,REJECT,no-resolve

# > ⑩ 网络欺诈拦截 - 拦截模块（默认启用）

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/Scam_Block.list,REJECT,no-resolve

# > ⑪ 风险通信观察列表 - 观察模块（默认启用）

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/Quarantine_Block.list,REJECT,pre-matching,no-resolve

# > 智能助理

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/OpenAI.list,Proxy

# > 苹果服务

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/Apple.list,DIRECT,extended-matching,no-resolve

# > GitHub

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/GitHub.list,Proxy

# > Crypto

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/Crypto.list,Proxy

# > 微软服务

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/Microsoft.list,DIRECT

# > 谷歌服务

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/Google.list,Proxy

# > 社交平台

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/Telegram.list,Proxy

# > 游戏平台

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/GamePlatforms.list,Proxy

# > WeChat

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/WeChat.list,DIRECT

# > 流媒体

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/ChinaMedia.list,DIRECT

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/GlobalMedia.list,Proxy

# > 区域路由

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/RegionalRouting.list,DIRECT

# > Proxy

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/Proxy.list,Proxy

# > China

RULE-SET,https://raw.githubusercontent.com/Thoseyearsbrian/Aegis/main/rules/China.list,DIRECT

# > Surge VIF NetBIOS Local Broadcast（Surge VIF NetBIOS 本地广播通信）

IP-CIDR,198.19.255.255/32,REJECT,no-resolve # 拦截老旧 NetBIOS 本地广播通信（现代系统通常无需使用）

# > 局域网地址

RULE-SET,LAN,DIRECT

# > 可选区域分流功能（默认关闭）

# - 用途：为普通用户提供简化的国际分流能力，减少访问受阻情况
# - 默认：关闭，保持 Aegis 防火墙强安全策略（FINAL,REJECT）
# - 启用：删除规则行首 “# ” 即可启用对应区域分流条目

# GEOIP,US,Proxy # 美国区域流量走代理

# GEOIP,GB,Proxy # 英国区域流量走代理

# GEOIP,FR,Proxy # 法国区域流量走代理

# GEOIP,DE,Proxy # 德国区域流量走代理

# GEOIP,RU,Proxy # 俄罗斯区域流量走代理

# GEOIP,AU,Proxy # 澳大利亚区域流量走代理

# GEOIP,JP,Proxy # 日本区域流量走代理

# GEOIP,KR,Proxy # 韩国区域流量走代理

# GEOIP,SG,Proxy # 新加坡区域流量走代理

# > GEOIP 匹配中国大陆

GEOIP,CN,DIRECT # GEOIP 匹配中国大陆
  `;

  console.log('Testing full user input...');
  const t0 = Date.now();
  const res = await service.ingestSurgeRulesBlock(userRulesText, { downloadRuleSets: true });
  console.log('Ingest Elapsed:', Date.now() - t0, 'ms');
  console.log('Summary:', JSON.stringify({
    totalLines: res.totalLines,
    parsedRulesCount: res.parsedRulesCount,
    ruleSetsFetchedCount: res.ruleSetsFetchedCount,
    rejectCount: res.rejectCount,
    directCount: res.directCount,
    proxyCount: res.proxyCount,
    otherCount: res.otherCount,
    groupsUpdated: res.groupsUpdated
  }, null, 2));

  // 验证 block 分组里是否有 gyks.cf 和 997557.xyz 和 adtrack
  const blockRules = await service['db'].getDiversionRules('block');
  console.log('Block rules count in DB:', blockRules.length);

  const proxyRules = await service['db'].getDiversionRules('proxy');
  const gyksRule = proxyRules.find(r => r.pattern.includes('gyks.cf'));
  console.log('gyks.cf rule in proxy group:', JSON.stringify(gyksRule));

  const directRules = await service['db'].getDiversionRules('direct');
  const xyzRule = directRules.find(r => r.pattern.includes('997557.xyz'));
  console.log('997557.xyz rule in direct group:', JSON.stringify(xyzRule));

  const geoipRule = directRules.find(r => r.pattern === 'cn' && r.match_type === 'GEOIP');
  console.log('GEOIP CN rule in direct group:', JSON.stringify(geoipRule));

  Script.exit(0);
}

main().catch(console.error);

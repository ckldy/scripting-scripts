import {
  Script,
  Navigation,
  NavigationStack,
  List,
  Section,
  HStack,
  VStack,
  Text,
  Button,
  Toggle,
  TextField,
  Spacer,
  Image,
  useState,
  Toolbar,
  ToolbarItem,
} from 'scripting';

import { LocalDnsServer } from './src/server';
import { Store } from './src/store';
import { AuditManager } from './src/audit';
import { CacheManager } from './src/cache';
import { AdGuardEngine } from './src/adguard';
import { DiversionEngine } from './src/diversion';
import { DnsResolver, cleanDomain } from './src/resolver';
import { parseDnsPacket, serializeDnsPacket } from './src/dns-packet';
import { ModuleManager } from './src/modules/module-manager';
import { FakeIpPool } from './src/mitm/fakeip';
import { StreamCleaner } from './src/stream/cleaner';
import type { DnsPacket } from './src/types';

// WebViewController global declaration for TypeScript
declare class WebViewController {
  constructor(options?: { ephemeral?: boolean });
  loadURL(url: string): Promise<boolean>;
  present(options?: { fullscreen?: boolean; navigationTitle?: string }): Promise<void>;
  dispose(): void;
}
declare namespace Pasteboard {
  function setString(text: string | null): Promise<void>;
}
declare namespace Safari {
  function openURL(url: string): Promise<void>;
}

const APP_VERSION = 'v1.4.7';
const APP_BUILD = '20261018';
const APP_AUTHOR = 'vcncv';
const UPSTREAM_REPO = 'https://github.com/yyhoworks/LocalDNS';

function LocalDnsApp() {
  const server = LocalDnsServer.get();
  const store = Store.get();

  const handleExitScript = () => {
    server.stop();
    if (typeof BackgroundKeeper !== 'undefined' && BackgroundKeeper.stopKeepAlive) {
      try { BackgroundKeeper.stopKeepAlive(); } catch {}
    }
    Script.exit();
  };

  // Server state
  const [isRunning, setIsRunning] = useState<boolean>(server.getIsRunning());
  const [port, setPort] = useState<number>(server.getPort());

  // Stats state
  const [stats, setStats] = useState(AuditManager.get().getStats());
  const [moduleStats, setModuleStats] = useState(ModuleManager.get().getStats());
  const [fakeipStats, setFakeipStats] = useState(FakeIpPool.get().getStats());
  const [lastRefreshed, setLastRefreshed] = useState<string>(
    new Date().toLocaleTimeString('zh-CN', { hour12: false })
  );

  // Switch states
  const initialSwitches = store.getSwitches();
  const [switchAdguard, setSwitchAdguard] = useState<boolean>(initialSwitches.switch7 === 'A');
  const [switchCache, setSwitchCache] = useState<boolean>(initialSwitches.switch13 === 'A');
  const [switchLazyCache, setSwitchLazyCache] = useState<boolean>(initialSwitches.switch4 === 'A');
  const [switchIpv6Block, setSwitchIpv6Block] = useState<boolean>(initialSwitches.switch6 === 'A');
  const [switchReqBlock, setSwitchReqBlock] = useState<boolean>(initialSwitches.switch1 === 'A');
  const [switchMitm, setSwitchMitm] = useState<boolean>(initialSwitches.switch_mitm !== 'B');
  const [switchRewrite, setSwitchRewrite] = useState<boolean>(initialSwitches.switch_rewrite !== 'B');

  // DNS Tester state
  const [testDomain, setTestDomain] = useState<string>('baidu.com');
  const [testResult, setTestResult] = useState<string>('');
  const [isTesting, setIsTesting] = useState<boolean>(false);

  // Status message
  const [statusMessage, setStatusMessage] = useState<string>('');

  const refreshStats = () => {
    setStats(AuditManager.get().getStats());
    setModuleStats(ModuleManager.get().getStats());
    setFakeipStats(FakeIpPool.get().getStats());
    setLastRefreshed(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
  };

  const handleTestYoutubeStreamAd = () => {
    const url = 'https://rr1---sn-4g5edn6e.googlevideo.com/videoplayback?id=123&adformat=1';
    const hit = ModuleManager.get().matchRewrite(url);
    if (hit) {
      setStatusMessage(`🎬 YouTube 视频流切片阻断测试: 命中 [${hit.rule.pattern}] ➔ 动作: ${hit.action} (成功消除前贴/中插切片)`);
    } else {
      setStatusMessage('未命中 YouTube 阻断规则');
    }
    refreshStats();
  };

  const handleTestTwitchM3u8Clean = () => {
    const dirty = `#EXTM3U\n#EXT-X-DATERANGE:ID="stitched-ad-123",PLANNED-DURATION=15.0\n#EXTINF:6.0,\nhttps://video.com/seg1.ts\n#EXT-X-TWITCH-PREFETCH:https://video.com/pref.ts\n#EXTINF:6.0,\nhttps://video.com/ad_segment.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:6.0,\nhttps://video.com/seg2.ts`;
    const cleaned = StreamCleaner.cleanM3U8(dirty, 'https://usher.ttvnw.net/test.m3u8');
    const strippedAd = !cleaned.includes('stitched-ad') && !cleaned.includes('ad_segment.ts');
    setStatusMessage(`📺 Twitch M3U8 流清洗测试: ${strippedAd ? '成功剥离 SSAI 广告切片与预取行！' : '清洗未变动'}`);
    refreshStats();
  };

  const handleTestBilibiliAd = () => {
    const url = 'https://api.bilibili.com/x/v2/splash';
    const hit = ModuleManager.get().matchRewrite(url);
    if (hit) {
      setStatusMessage(`⚡️ 哔哩哔哩开屏去广告测试: 命中 [${hit.rule.pattern}] ➔ 动作: ${hit.action} (秒开无广告)`);
    } else {
      setStatusMessage('未命中 B站 去广告规则');
    }
    refreshStats();
  };

  const handleTestUniversalVideoSdk = () => {
    const url = 'https://imasdk.googleapis.com/js/sdkloader/ima3.js';
    const hit = ModuleManager.get().matchRewrite(url);
    if (hit) {
      setStatusMessage(`🛡️ 全网通用视频SDK桩测试: 命中 [${hit.rule.pattern}] ➔ 动作: ${hit.action} (本地 Mock 播放器广告桩)`);
    } else {
      setStatusMessage('未命中 Google IMA 桩规则');
    }
    refreshStats();
  };

  const copyHttpProxyConfig = async () => {
    const snippet = `HTTP 代理服务器: 127.0.0.1\n端口: ${port}\n\nSurge 节点配置:\nLocalDNS-Proxy = http, 127.0.0.1, ${port}\n\nLoon 节点配置:\nLocalDNS-Proxy = http, 127.0.0.1, ${port}\n\n小火箭代理行:\nhttp://127.0.0.1:${port}`;
    if (typeof Pasteboard !== 'undefined' && Pasteboard.setString) {
      await Pasteboard.setString(snippet);
      setStatusMessage(`已复制透明 HTTP 代理配置：127.0.0.1:${port}！`);
    }
  };

  const handleToggleServer = async () => {
    if (isRunning) {
      server.stop();
      setIsRunning(false);
      if (typeof BackgroundKeeper !== 'undefined' && BackgroundKeeper.stopKeepAlive) {
        try { await BackgroundKeeper.stopKeepAlive(); } catch {}
      }
      setStatusMessage('LocalDNS 服务已暂停，后台保活已释放');
    } else {
      const res = server.start(port);
      if (res.success) {
        setIsRunning(true);
        setPort(res.port);
        if (typeof BackgroundKeeper !== 'undefined' && BackgroundKeeper.keepAlive) {
          try { await BackgroundKeeper.keepAlive(); } catch {}
        }
        setStatusMessage(`LocalDNS 服务已在端口 ${res.port} 启动，后台长驻保活已激活！`);
      } else {
        setStatusMessage(`启动失败: ${res.error}`);
      }
    }
  };

  const openGlassConsole = async () => {
    if (!isRunning) {
      const res = server.start(port);
      if (res.success) {
        setIsRunning(true);
        setPort(res.port);
      }
    }
    const currentPort = server.getPort();
    const proto = server.getProtocol();
    const webView = new WebViewController();
    try {
      await webView.loadURL(`${proto}://127.0.0.1:${currentPort}/ui/`);
      await webView.present({
        fullscreen: true,
        navigationTitle: 'LocalDNS 玻璃质感控制台',
      });
    } finally {
      webView.dispose();
      refreshStats();
    }
  };

  const openInSafari = async () => {
    if (!isRunning) {
      const res = server.start(port);
      if (res.success) {
        setIsRunning(true);
        setPort(res.port);
      }
    }
    const currentPort = server.getPort();
    const proto = server.getProtocol();
    try {
      if (typeof Safari !== 'undefined' && Safari.openURL) {
        await Safari.openURL(`${proto}://127.0.0.1:${currentPort}/ui/`);
      }
    } catch {}
  };

  const copyDohUrl = async () => {
    const dohUrl = `http://127.0.0.1:${port}/dns-query`;
    if (typeof Pasteboard !== 'undefined' && Pasteboard.setString) {
      await Pasteboard.setString(dohUrl);
      setStatusMessage(`已复制通用 DoH 地址到剪贴板: ${dohUrl}`);
    }
  };

  const installCaCert = async () => {
    if (!isRunning) {
      server.start(port);
      setIsRunning(true);
    }
    const certUrl = `http://127.0.0.1:${port}/ui/ca.crt`;
    if (typeof Safari !== 'undefined' && Safari.openURL) {
      await Safari.openURL(certUrl);
      setStatusMessage('正在下载 CA 根证书，请前往 iOS“设置”->“已下载描述文件”安装，并在“通用”->“关于本机”->“证书信任设置”开启完全信任！');
    }
  };

  const copySurgeDohConfig = async () => {
    const snippet = `[General]\ndoh-server = https://127.0.0.1:9443/dns-query\nskip-proxy = 127.0.0.1, localhost, *.local, 192.168.0.0/16\n\n[Rule]\nIP-CIDR,223.5.5.5/32,DIRECT,no-resolve\nIP-CIDR,119.29.29.29/32,DIRECT,no-resolve`;
    if (typeof Pasteboard !== 'undefined' && Pasteboard.setString) {
      await Pasteboard.setString(snippet);
      setStatusMessage(`已复制 Surge 专属 DoH 配置：doh-server = https://127.0.0.1:9443/dns-query！`);
    }
  };

  const mountSurgeModule = async () => {
    const modUrl = `http://127.0.0.1:${port}/localdns.sgmodule`;
    const surgeScheme = `surge:///install-module?url=${encodeURIComponent(modUrl)}`;
    if (typeof Safari !== 'undefined' && Safari.openURL) {
      await Safari.openURL(surgeScheme);
    }
    setStatusMessage(`正在调起 Surge 安装模块: ${modUrl}`);
  };

  const copySurgeModuleUrl = async () => {
    const modUrl = `http://127.0.0.1:${port}/localdns.sgmodule`;
    if (typeof Pasteboard !== 'undefined' && Pasteboard.setString) {
      await Pasteboard.setString(modUrl);
      setStatusMessage(`已复制 Surge 模块编译链接: ${modUrl}`);
    }
  };

  const mountLoonPlugin = async () => {
    const pluginUrl = `http://127.0.0.1:${port}/localdns.plugin`;
    const loonScheme = `loon://import?plugin=${encodeURIComponent(pluginUrl)}`;
    if (typeof Safari !== 'undefined' && Safari.openURL) {
      await Safari.openURL(loonScheme);
    }
    setStatusMessage(`正在调起 Loon 安装插件: ${pluginUrl}`);
  };

  const copyLoonPluginUrl = async () => {
    const pluginUrl = `http://127.0.0.1:${port}/localdns.plugin`;
    if (typeof Pasteboard !== 'undefined' && Pasteboard.setString) {
      await Pasteboard.setString(pluginUrl);
      setStatusMessage(`已复制 Loon 插件编译链接: ${pluginUrl}`);
    }
  };

  const copyQxConfUrl = async () => {
    const confUrl = `http://127.0.0.1:${port}/localdns.conf`;
    if (typeof Pasteboard !== 'undefined' && Pasteboard.setString) {
      await Pasteboard.setString(confUrl);
      setStatusMessage(`已复制 Quantumult X 规则链接: ${confUrl}`);
    }
  };

  const handleReissueCert = async () => {
    setStatusMessage('正在重新加载并生效 TLS 证书...');
    const ok = server.reloadTlsServer();
    if (ok) {
      setStatusMessage('CA 证书与 TLS 服务端已重新热重载生效！请点击「安装 CA 根证书」重新下载并在系统中完全信任！');
    } else {
      setStatusMessage('TLS 服务端重新重载完成');
    }
  };

  const openUpstreamRepo = async () => {
    if (typeof Safari !== 'undefined' && Safari.openURL) {
      await Safari.openURL(UPSTREAM_REPO);
    }
  };

  const handleSwitchChange = (tag: any, val: boolean, setter: (v: boolean) => void) => {
    setter(val);
    store.setSwitch(tag, val ? 'A' : 'B');
    setStatusMessage(`设置已更新: ${tag} -> ${val ? '开启' : '关闭'}`);
  };

  const handleClearCache = () => {
    CacheManager.get().clearAll();
    refreshStats();
    setStatusMessage('已清空全部本地 DNS 缓存池');
  };

  const handleTestDns = async () => {
    const rawDomain = testDomain.trim();
    if (!rawDomain) return;
    const pureDomain = cleanDomain(rawDomain);

    setIsTesting(true);
    setTestResult('正在通过本地引擎解析...');

    const start = Date.now();
    try {
      const dummyPacket: DnsPacket = {
        id: Math.floor(Math.random() * 65535),
        flags: 0x0100, // RD set
        qr: false,
        opcode: 0,
        aa: false,
        tc: false,
        rd: true,
        ra: false,
        rcode: 0,
        rcodeName: 'NOERROR',
        questions: [{ name: pureDomain, type: 1, typeName: 'A', class: 1 }],
        answers: [],
        authorities: [],
        additionals: [],
      };

      const queryBytes = serializeDnsPacket(dummyPacket);
      const respBytes = await DnsResolver.get().resolve(queryBytes, '127.0.0.1');
      const respPacket = parseDnsPacket(respBytes);
      const elapsed = Date.now() - start;

      const ips = respPacket.answers.map(a => String(a.data)).filter(Boolean);
      const diversion = DiversionEngine.get().match(pureDomain, '127.0.0.1');

      let summary = `查询域名: ${pureDomain}${rawDomain !== pureDomain ? ` (已自动过滤输入中的端口或协议)` : ''}\n`;
      summary += `状态: ${respPacket.rcodeName} (${elapsed}ms)\n`;
      summary += `命中策略: ${diversion.domainSet} (所属组: ${diversion.group})\n`;
      summary += `解析 IP (${ips.length}): ${ips.join(', ') || '无记录'}`;
      setTestResult(summary);
      refreshStats();
    } catch (e: any) {
      setTestResult(`解析出错: ${e.message || String(e)}`);
    } finally {
      setIsTesting(false);
    }
  };

  const dohAddress = `http://127.0.0.1:${port}/dns-query`;

  return (
    <NavigationStack>
      <List
        navigationTitle={`LocalDNS ${APP_VERSION}`}
        navigationBarTitleDisplayMode="inline"
        toolbar={
          <Toolbar>
            <ToolbarItem placement="primaryAction">
              <Button title="刷新" action={refreshStats} />
            </ToolbarItem>
          </Toolbar>
        }
      >
        {/* 系统黄色胶囊按键后台运行气泡提示 */}
        <Section>
          <HStack alignment="center">
            <Image systemName="info.circle.fill" tint="#f59e0b" />
            <Text bold font="subheadline" foregroundStyle="tintColor">
              请使用系统的黄色胶囊按键进入后台
            </Text>
          </HStack>
        </Section>

        {/* 服务核心状态 */}
        <Section header={<Text>服务状态与控制</Text>}>
          <HStack alignment="center">
            <Image
              systemName={isRunning ? 'checkmark.shield.fill' : 'xmark.shield.fill'}
              tint={isRunning ? '#10b981' : '#f59e0b'}
            />
            <VStack alignment="leading">
              <Text bold>{isRunning ? 'LocalDNS 服务运行中' : 'LocalDNS 服务已暂停'}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                控制台: {port} · DoH: 9443 · {isRunning ? '后台保活: 持续运行' : '后台保活: 已挂起'}
              </Text>
            </VStack>
            <Spacer />
            <Button
              title={isRunning ? '暂停' : '启动'}
              action={handleToggleServer}
            />
          </HStack>

          <Button
            title="打开玻璃质感 Web 控制台"
            action={openGlassConsole}
          />

          <HStack>
            <Button title="复制 DoH 地址" action={copyDohUrl} />
            <Spacer />
            <Button title="Safari 打开" action={openInSafari} />
          </HStack>
        </Section>

        {/* 提示信息 */}
        {statusMessage ? (
          <Section>
            <Text font="caption" foregroundStyle="tintColor">
              {statusMessage}
            </Text>
          </Section>
        ) : null}

        {/* 实时数据概览 */}
        <Section
          header={<Text>运行指标统计</Text>}
          footer={<Text>最后更新时间: {lastRefreshed}</Text>}
        >
          <HStack>
            <Text>累计 DNS 查询</Text>
            <Spacer />
            <Text bold>{stats.total_queries} 次</Text>
          </HStack>

          <HStack>
            <Text>广告拦截数量</Text>
            <Spacer />
            <Text bold foregroundStyle="systemRed">{stats.blocked_queries} 次</Text>
          </HStack>

          <HStack>
            <Text>核心缓存命中率</Text>
            <Spacer />
            <Text bold foregroundStyle="systemGreen">{stats.cache_hit_rate}%</Text>
          </HStack>

          <HStack>
            <Text>平均查询延迟</Text>
            <Spacer />
            <Text bold>{stats.average_duration_ms} ms</Text>
          </HStack>

          <HStack>
            <Text>活跃客户端设备</Text>
            <Spacer />
            <Text>{stats.active_clients} 台</Text>
          </HStack>

          <HStack>
            <Text>追踪域名数量</Text>
            <Spacer />
            <Text>{stats.tracked_domains} 个</Text>
          </HStack>
        </Section>

        {/* 快捷功能开关 */}
        <Section header={<Text>核心功能策略开关</Text>}>
          <Toggle
            title="广告拦截 (AdGuard 过滤规则)"
            value={switchAdguard}
            onChanged={(val) => handleSwitchChange('switch7', val, setSwitchAdguard)}
          />

          <Toggle
            title="核心缓存池 (多级 DNS 缓存)"
            value={switchCache}
            onChanged={(val) => handleSwitchChange('switch13', val, setSwitchCache)}
          />

          <Toggle
            title="过期缓存 (允许过期响应极速回退)"
            value={switchLazyCache}
            onChanged={(val) => handleSwitchChange('switch4', val, setSwitchLazyCache)}
          />

          <Toggle
            title="IPv6 屏蔽 (拦截 AAAA 请求)"
            value={switchIpv6Block}
            onChanged={(val) => handleSwitchChange('switch6', val, setSwitchIpv6Block)}
          />

          <Toggle
            title="请求屏蔽 (无解析结果请求拦截)"
            value={switchReqBlock}
            onChanged={(val) => handleSwitchChange('switch1', val, setSwitchReqBlock)}
          />

          <Toggle
            title="MITM 流量接管 (FakeIP 虚拟映射)"
            value={switchMitm}
            onChanged={(val) => handleSwitchChange('switch_mitm', val, setSwitchMitm)}
          />

          <Toggle
            title="HTTP 重写引擎 (Redirect / Reject / Header / Body)"
            value={switchRewrite}
            onChanged={(val) => handleSwitchChange('switch_rewrite', val, setSwitchRewrite)}
          />
        </Section>

        {/* 跨平台模块与流清洗 (Surge/Loon/QX) */}
        <Section
          header={<Text>跨平台模块与视频流清洗 (Surge/Loon/QX)</Text>}
          footer={<Text>支持无缝载入 Surge (.sgmodule)、Loon (.plugin) 与 Quantumult X 规则，通过 FakeIP 截获流量并剥离 HLS M3U8 切片与播放器 JSON 广告。</Text>}
        >
          <HStack>
            <Text>模块状态</Text>
            <Spacer />
            <Text bold>{moduleStats.activeModules} / {moduleStats.totalModules} 个已激活</Text>
          </HStack>

          <HStack>
            <Text>MITM 域名监听</Text>
            <Spacer />
            <Text bold>{moduleStats.totalMitmHosts} 个通配主机</Text>
          </HStack>

          <HStack>
            <Text>重写规则 / 脚本</Text>
            <Spacer />
            <Text>{moduleStats.totalRewrites} 条 / {moduleStats.totalScripts} 个</Text>
          </HStack>

          <HStack>
            <Text>流清洗命中 / 静态阻断</Text>
            <Spacer />
            <Text bold foregroundStyle="systemGreen">{moduleStats.cleanedStreams} 次 / {moduleStats.hitRewrites} 次</Text>
          </HStack>

          <HStack>
            <Text>FakeIP 池占用 (198.18.0.0/15)</Text>
            <Spacer />
            <Text>{fakeipStats.allocated} 个已分配</Text>
          </HStack>

          <HStack>
            <Button
              title="测试: YouTube 视频流切片阻断"
              action={handleTestYoutubeStreamAd}
            />
            <Spacer />
            <Button
              title="测试: Twitch M3U8 清单清洗"
              action={handleTestTwitchM3u8Clean}
            />
          </HStack>

          <HStack>
            <Button
              title="测试: 哔哩哔哩开屏/中插去广告"
              action={handleTestBilibiliAd}
            />
            <Spacer />
            <Button
              title="测试: 全网通用视频SDK桩 (IMA3)"
              action={handleTestUniversalVideoSdk}
            />
          </HStack>

          <HStack>
            <Button
              title="⚡️ 一键挂载 Surge 模块"
              action={mountSurgeModule}
            />
            <Spacer />
            <Button
              title="🎈 一键安装 Loon 插件"
              action={mountLoonPlugin}
            />
          </HStack>

          <HStack>
            <Button
              title="复制 Surge 模块链接"
              action={copySurgeModuleUrl}
            />
            <Spacer />
            <Button
              title="复制 QX 重写规则"
              action={copyQxConfUrl}
            />
          </HStack>
        </Section>

        {/* 本地 DNS 实时解析排障 */}
        <Section
          header={<Text>DNS 实时解析与广告拦截测试</Text>}
          footer={<Text>{`🛡️ AdGuard 引擎: ${AdGuardEngine.get().getRuleCount().toLocaleString()} 条过滤规则生效中 · 开关: ${switchAdguard ? '已开启' : '已关闭'}`}</Text>}
        >
          <HStack alignment="center">
            <TextField
              title="测试域名"
              prompt="输入待测试域名 (例如 baidu.com 或广告域名)"
              value={testDomain}
              onChanged={setTestDomain}
            />
            <Button
              title={isTesting ? '解析中...' : '测试'}
              action={handleTestDns}
            />
          </HStack>

          <HStack>
            <Button
              title="测试: 正常域名 (baidu.com)"
              action={() => { setTestDomain('baidu.com'); setTimeout(handleTestDns, 50); }}
            />
            <Spacer />
            <Button
              title="测试: 广告域名 (mobads.baidu.com)"
              action={() => { setTestDomain('mobads.baidu.com'); setTimeout(handleTestDns, 50); }}
            />
          </HStack>

          {testResult ? (
            <VStack alignment="leading">
              <Text font="caption" foregroundStyle="secondaryLabel">解析结果:</Text>
              <Text font="subheadline">{testResult}</Text>
            </VStack>
          ) : null}
        </Section>

        {/* 客户端引流与流量接管详细使用教程 */}
        <Section
          header={<Text>客户端引流与流量接管详细指南</Text>}
          footer={<Text>LocalDNS 作为本地 DNS 核心服务端，需通过客户端或代理工具将 DNS 导流至本机，全机 App 流量才会进入控制台统计与 AdGuard 过滤。</Text>}
        >
          {/* Surge 详细使用方法 */}
          <VStack alignment="leading">
            <Text bold font="headline">⚡️ 方案 1：Surge 专属 DoH 接管 (强烈推荐)</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">
              DoH 地址严格锁定为 https://127.0.0.1:9443/dns-query，请按照以下 5 步完成闭环：
            </Text>
            <Text font="caption">
              1. 点击下方「安装 CA 根证书」，在 Safari 中允许下载描述文件；
            </Text>
            <Text font="caption">
              2. 打开 iOS「设置」➔「已下载的描述文件」，点击安装 LocalDNS Root CA；
            </Text>
            <Text font="caption" foregroundStyle="systemRed">
              3. 【关键核心】前往「设置」➔「通用」➔「关于本机」➔「证书信任设置」，开启完全信任！
            </Text>
            <Text font="caption">
              4. 点击下方「复制 Surge 专属 DoH 配置」，粘贴至 Surge 配置文件文本模式；
            </Text>
            <Text font="caption">
              5. 开启 Surge 代理，在浏览器中访问任意网页，控制台日志将实时刷屏！
            </Text>
          </VStack>

          <HStack>
            <Button
              title="① 安装 CA 根证书"
              action={installCaCert}
            />
            <Spacer />
            <Button
              title="重新生成 CA 证书"
              action={handleReissueCert}
            />
          </HStack>

          <Button
            title="② 复制 Surge 专属 DoH 配置 (https://127.0.0.1:9443/dns-query)"
            action={copySurgeDohConfig}
          />

          {/* Shadowrocket 详细使用方法 */}
          <VStack alignment="leading">
            <Text bold font="headline">📱 方案 2：Shadowrocket (小火箭·免证书全局接管)</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">
              小火箭原生支持明文 HTTP DoH，无需安装和信任任何证书，只需 3 步：
            </Text>
            <Text font="caption">
              1. 点击下方「复制通用 DoH 地址」，获得 http://127.0.0.1:9099/dns-query；
            </Text>
            <Text font="caption">
              2. 打开小火箭 ➔ 底部「设置」➔「DNS」➔「DNS 覆写」，粘贴该地址并保存；
            </Text>
            <Text font="caption">
              3. 返回小火箭首页开启开关，即可瞬间接管全手机所有 App 的 DNS 流量！
            </Text>
          </VStack>

          <Button
            title="复制通用 DoH 地址 (http://127.0.0.1:9099/dns-query)"
            action={copyDohUrl}
          />

          {/* 电脑 / 局域网设备接管 */}
          <VStack alignment="leading">
            <Text bold font="headline">💻 方案 3：电脑 / 局域网设备接入 (家庭 DNS 防火墙)</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">
              让局域网内的 Mac、Windows PC 或电视盒子通过当前手机进行过滤与加速：
            </Text>
            <Text font="caption">
              1. 确保手机与电脑处于同一个 Wi-Fi 网络，查看当前 iPhone 的局域网 IP；
            </Text>
            <Text font="caption">
              2. 在电脑的 Chrome/Edge 浏览器 ➔「设置」➔「安全」➔ 开启「使用安全 DNS」；
            </Text>
            <Text font="caption">
              3. 选择「自定义」，填入 http://当前手机IP:{port}/dns-query 即可全局生效！
            </Text>
          </VStack>

          {/* 透明 HTTP 代理接管与视频流清洗 */}
          <VStack alignment="leading">
            <Text bold font="headline">🎬 方案 4：透明 HTTP 代理与视频流清洗接管 (全代理工具 / Wi-Fi)</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">
              端口 9099 已开启透明 HTTP 代理嗅探，直接接管 HTTP 流量并剥离视频切片与广告：
            </Text>
            <Text font="caption">
              1. Surge / Loon / 小火箭：添加本地 HTTP 节点 LocalDNS-Proxy = http, 127.0.0.1, {port}；
            </Text>
            <Text font="caption">
              2. 路由分流规则：将需要去广告的视频域名（如 *.googlevideo.com, *.bilibili.com 等）指向该代理；
            </Text>
            <Text font="caption">
              3. iOS Wi-Fi 代理：当前 Wi-Fi 设置 ➔ 配置代理选择手动 ➔ 服务器 127.0.0.1，端口 {port}。
            </Text>
          </VStack>

          <Button
            title={`复制 HTTP 代理配置 (127.0.0.1:${port})`}
            action={copyHttpProxyConfig}
          />

          {/* 方案 5：Surge / Loon 模块与 HTTPS MITM 挂载 (彻底去除 YouTube 视频广告) */}
          <VStack alignment="leading">
            <Text bold font="headline">🎬 方案 5：Surge / Loon 模块挂载与 HTTPS MITM (YouTube 去广告终极解法)</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">
              YouTube 与主流 App 视频流采用 HTTPS 端到端加密，纯 DNS 只能拦截外链追踪。要在客户端彻底剥离视频切片 (SSAI) 与播放器内插广告，必须一键挂载 LocalDNS 动态编译模块：
            </Text>
            <Text font="caption">
              1. 确保已安装并信任 CA 根证书（参考上方方案 1 步骤 1~3）；
            </Text>
            <Text font="caption">
              2. 点击下方「安装到 Surge」或「安装到 Loon」，客户端将自动下载本地编译的模块；
            </Text>
            <Text font="caption">
              3. 在 Surge/Loon 中启用该模块，勾选开启 MITM 解密，即可在 YouTube/B站中享受 100% 纯净无广告体验！
            </Text>
          </VStack>

          <HStack>
            <Button
              title="一键安装到 Surge 模块"
              action={mountSurgeModule}
            />
            <Spacer />
            <Button
              title="一键安装到 Loon 插件"
              action={mountLoonPlugin}
            />
          </HStack>

          <HStack>
            <Button
              title="复制 Surge 模块直链"
              action={copySurgeModuleUrl}
            />
            <Spacer />
            <Button
              title="复制 QX 重写引用链接"
              action={copyQxConfUrl}
            />
          </HStack>
        </Section>

        {/* 运维与规则更新 */}
        <Section header={<Text>运维与规则更新</Text>}>
          <HStack>
            <Button
              title="清空所有 DNS 缓存"
              action={handleClearCache}
            />
            <Spacer />
            <Button
              title="更新 AdGuard 规则"
              action={async () => {
                setStatusMessage('正在更新 AdGuard 规则...');
                const r = await AdGuardEngine.get().updateAll();
                setStatusMessage(`AdGuard 规则更新完成: 更新 ${r.updated_sources} 个，失败 ${r.errors.length} 个`);
              }}
            />
          </HStack>
        </Section>

        {/* 版本信息与开源鸣谢 */}
        <Section
          header={<Text>版本与开源致敬</Text>}
          footer={<Text>LocalDNS for Scripting · 由 vcncv 移植构建</Text>}
        >
          <HStack>
            <Text>当前版本</Text>
            <Spacer />
            <Text bold>{APP_VERSION} (Build {APP_BUILD})</Text>
          </HStack>

          <HStack>
            <Text>移植作者</Text>
            <Spacer />
            <Text bold>{APP_AUTHOR}</Text>
          </HStack>

          <VStack alignment="leading">
            <Text bold font="subheadline">致敬上游开源项目</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">
              原案来自 GitHub yyhoworks/LocalDNS 开源项目。特别感谢 R 大（折腾日记交流群，负责 Rust DNS 核心设计）与 yyhoworks（负责毛玻璃 UI 设计）！
            </Text>
          </VStack>

          <Button
            title="访问上游 GitHub 开源仓库"
            action={openUpstreamRepo}
          />

          <Button
            title="彻底退出并停止服务"
            role="destructive"
            action={handleExitScript}
          />
        </Section>
      </List>
    </NavigationStack>
  );
}

// Main execution entry point
async function run() {
  // 1. Enable minimize-on-swipe-dismiss so switching to other apps won't terminate LocalDNS!
  if (typeof Script.enableMinimize === 'function') {
    Script.enableMinimize(true);
  }

  // 2. Start dual-channel server (HTTP 9099 + HTTPS 9443)
  const server = LocalDnsServer.get();
  server.start(9099);

  // 3. Request official system background keep-alive to prevent iOS suspension
  if (typeof BackgroundKeeper !== 'undefined' && BackgroundKeeper.keepAlive) {
    try {
      await BackgroundKeeper.keepAlive();
    } catch {}
  }

  // 4. Permanent keepalive interval to maintain event loop references - NEVER CLEAR!
  // This ensures the JS runtime engine never marks the script as "completed" when UI is hidden.
  setInterval(() => {
    // Keepalive event loop tick
  }, 10000);

  // 5. Perpetual UI presentation loop:
  // When user taps "收起" or swipes down, the view is hidden, script stays alive in background!
  // When user taps the capsule or re-opens, the UI is seamlessly presented again.
  while (true) {
    await Navigation.present({
      element: <LocalDnsApp />,
      modalPresentationStyle: 'pageSheet',
    });

    // Ensure the system minimization state is invoked when sheet is dismissed
    if (typeof Script.minimize === 'function') {
      try {
        await Script.minimize();
      } catch {}
    }

    // Suspend and await next resume trigger from system capsule or user tap
    await new Promise<void>((resolve) => {
      let resolved = false;
      let removeListener: (() => void) | null = null;
      if (typeof Script.onResume === 'function') {
        removeListener = Script.onResume(() => {
          if (!resolved) {
            resolved = true;
            if (removeListener) {
              try { removeListener(); } catch {}
            }
            resolve();
          }
        });
      }
    });
  }
}

run();

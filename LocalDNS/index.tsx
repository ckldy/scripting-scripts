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

const APP_VERSION = 'v1.9.0';
const APP_BUILD = '20261022';
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

  // Native System VPN state
  const [vpnState, setVpnState] = useState<{ status: string; active: boolean }>({
    status: 'disconnected',
    active: false,
  });
  const [isVpnToggling, setIsVpnToggling] = useState<boolean>(false);

  // Stats state
  const [stats, setStats] = useState(AuditManager.get().getStats());
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

  // SmartDNS-inspired advanced config
  const initialSpeed = store.getSpeedConfig();
  const [switchSpeed, setSwitchSpeed] = useState<boolean>(initialSpeed.enabled);
  const [switchDualstack, setSwitchDualstack] = useState<boolean>(initialSpeed.dualstackSelection);
  const initialDns64 = store.getDns64Config();
  const [switchDns64, setSwitchDns64] = useState<boolean>(initialDns64.enabled);

  // DNS Tester state
  const [testDomain, setTestDomain] = useState<string>('baidu.com');
  const [testResult, setTestResult] = useState<string>('');
  const [isTesting, setIsTesting] = useState<boolean>(false);

  // Status message
  const [statusMessage, setStatusMessage] = useState<string>('');

  const refreshStats = () => {
    setStats(AuditManager.get().getStats());
    setLastRefreshed(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    refreshVpnState();
  };

  const refreshVpnState = async () => {
    try {
      if (typeof VPN !== 'undefined' && VPN.getState) {
        const s = await VPN.getState();
        setVpnState({ status: s.status, active: s.active });
      }
    } catch {}
  };


  const handleToggleVpn = async () => {
    if (typeof VPN === 'undefined') {
      setStatusMessage('当前环境不支持 Scripting 原生 VPN API');
      return;
    }
    setIsVpnToggling(true);
    try {
      const cur = await VPN.getState();
      if (cur.active || cur.status === 'connected') {
        setStatusMessage('正在停止原生纯净 VPN 隧道...');
        const next = await VPN.stop();
        setVpnState({ status: next.status, active: next.active });
        setStatusMessage('原生系统 VPN 已断开');
      } else {
        setStatusMessage('正在启动原生纯净 VPN 隧道...');
        const next = await VPN.start();
        setVpnState({ status: next.status, active: next.active });
        setStatusMessage('🛡️ 原生系统级 VPN 已成功连接！全设备广告已由本地直接接管！');
      }
    } catch (err: any) {
      setStatusMessage(`VPN 控制失败: ${err.message}`);
    } finally {
      setIsVpnToggling(false);
    }
  };

  const installAppleDnsProfile = async () => {
    if (!isRunning) {
      server.start(port);
      setIsRunning(true);
    }
    const profileUrl = `http://127.0.0.1:${port}/localdns.mobileconfig`;
    if (typeof Safari !== 'undefined' && Safari.openURL) {
      await Safari.openURL(profileUrl);
      setStatusMessage('正在下载 Apple 官方原生加密 DNS 描述文件（已合入 LocalDNS 根证书与内核级 DoH）。请前往 iOS「设置」➔「已下载描述文件」安装！');
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

  const handleSpeedToggle = (val: boolean) => {
    setSwitchSpeed(val);
    store.setSpeedConfig({ enabled: val });
    setStatusMessage(`智能测速选优已${val ? '开启' : '关闭'}`);
  };

  const handleDualstackToggle = (val: boolean) => {
    setSwitchDualstack(val);
    store.setSpeedConfig({ dualstackSelection: val });
    setStatusMessage(`双栈优选已${val ? '开启' : '关闭'}`);
  };

  const handleDns64Toggle = (val: boolean) => {
    setSwitchDns64(val);
    store.setDns64Config({ enabled: val });
    setStatusMessage(`DNS64 已${val ? '开启' : '关闭'}`);
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

        {/* 🛡️ 原生系统级零外挂纯净闭环控制专区 */}
        <Section
          header={<Text>🛡️ 原生系统级零外挂纯净闭环</Text>}
          footer={<Text>无需安装任何第三方外挂软件（如 Surge/Loon/小火箭），直接通过 iOS 原生能力闭环完成广告拦截与切片清洗。</Text>}
        >
          {/* Scripting 原生 VPN 隧道控制 */}
          <HStack alignment="center">
            <Image
              systemName={vpnState.active || vpnState.status === 'connected' ? 'lock.shield.fill' : 'shield.slash.fill'}
              tint={vpnState.active || vpnState.status === 'connected' ? '#10b981' : '#6b7280'}
            />
            <VStack alignment="leading">
              <Text bold>
                {vpnState.active || vpnState.status === 'connected'
                  ? '原生纯净 VPN 运行中'
                  : '原生纯净 VPN 未连接'}
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                {vpnState.active || vpnState.status === 'connected'
                  ? '状态: 已连接 · 全设备流量由本地闭环接管'
                  : `状态: ${vpnState.status} · 点击一键启动系统原生隧道`}
              </Text>
            </VStack>
            <Spacer />
            <Button
              title={
                isVpnToggling
                  ? '切换中...'
                  : vpnState.active || vpnState.status === 'connected'
                  ? '断开'
                  : '一键启动'
              }
              action={handleToggleVpn}
            />
          </HStack>

          {/* Apple 原生加密 DNS 描述文件安装 */}
          <HStack alignment="center">
            <Image systemName="arrow.down.doc.fill" tint="#3b82f6" />
            <VStack alignment="leading">
              <Text bold>Apple 原生加密 DNS 描述文件</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                系统内核级 DoH 直连 · 零耗电 · 自动拦截 18.5 万条广告
              </Text>
            </VStack>
            <Spacer />
            <Button
              title="一键安装"
              action={installAppleDnsProfile}
            />
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
        </Section>

        {/* 智能测速与高级解析 (参考 SmartDNS) */}
        <Section
          header={<Text>智能测速与高级解析</Text>}
          footer={<Text>测速选最快 IP：对上游返回的多个 A/AAAA 做 TCP 握手测速（tcp:443/80），返回访问最快的地址；关闭则透传上游顺序。</Text>}
        >
          <Toggle
            title="智能测速选优 (返回最快 IP)"
            value={switchSpeed}
            onChanged={handleSpeedToggle}
          />
          <Toggle
            title="双栈优选 (IPv4 明显更快时跳过 IPv6)"
            value={switchDualstack}
            onChanged={handleDualstackToggle}
          />
          <Toggle
            title="DNS64 (AAAA 无结果时由 A 合成)"
            value={switchDns64}
            onChanged={handleDns64Toggle}
          />
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

        {/* 零外挂纯净闭环与引流详细指南 */}
        <Section
          header={<Text>零外挂纯净闭环与引流详细指南</Text>}
          footer={<Text>LocalDNS 支持 Scripting 原生系统级 VPN、Apple 原生加密 DNS 描述文件与 Wi-Fi 代理，无需依赖任何第三方 App 即可实现全自动去广告闭环。</Text>}
        >
          {/* 方案 1：Scripting 原生全局 VPN 隧道 */}
          <VStack alignment="leading">
            <Text bold font="headline">⚡️ 方案 1：Scripting 原生全局 VPN (首选推荐·一键闭环)</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">
              完全不需要安装 Surge、Loon、小火箭等任何外部软件！直接由 Scripting 官方系统级 VPN 隧道接管：
            </Text>
            <Text font="caption">
              1. 点击上方「🛡️ 原生系统级零外挂纯净闭环」专区的【一键启动】按键；
            </Text>
            <Text font="caption">
              2. 首次启动时系统会弹出 iOS 官方标准的“添加 VPN 配置”授权，点击“允许”；
            </Text>
            <Text font="caption">
              3. 连接成功后，全手机所有网络流量立即由系统内核原生隧道无缝接管，广告切片与 18.5 万条域名由 LocalDNS 内部流水线直接清洗！
            </Text>
          </VStack>

          <Button
            title={
              isVpnToggling
                ? '正在操作原生 VPN...'
                : vpnState.active || vpnState.status === 'connected'
                ? '暂停 Scripting 原生 VPN 隧道'
                : '一键启动 Scripting 原生纯净 VPN'
            }
            action={handleToggleVpn}
          />

          {/* 方案 2：Apple 原生加密 DNS 描述文件 */}
          <VStack alignment="leading">
            <Text bold font="headline">🍎 方案 2：Apple 原生加密 DNS 描述文件 (零外挂·零耗电·免代理)</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">
              iOS 14+ 官方支持的系统级 Encrypted DNS (DoH) 标准，由苹果操作系统内核直接驱动：
            </Text>
            <Text font="caption">
              1. 点击下方「安装 Apple 纯净 DNS 描述文件」，Safari 将提示允许下载配置文件；
            </Text>
            <Text font="caption">
              2. 打开 iPhone「设置」➔ 顶部点击「已下载的描述文件」➔ 安装「LocalDNS 原生纯净加密 DNS」（已自动合入安全根证书与 DNS 设置）；
            </Text>
            <Text font="caption" foregroundStyle="systemRed">
              3. 【关键必做】前往「设置」➔「通用」➔「关于本机」➔「证书信任设置」，开启 LocalDNS Root CA 完全信任！
            </Text>
            <Text font="caption">
              4. 前往「设置」➔「通用」➔「VPN 与设备管理」➔「DNS」中勾选 LocalDNS；
            </Text>
            <Text font="caption">
              5. 全局 18.5 万条广告域名由 iOS 内核直接阻断，后台零额外耗电，免开任何代理工具！
            </Text>
          </VStack>

          <Button
            title="一键安装 Apple 官方纯净 DNS 描述文件"
            action={installAppleDnsProfile}
          />

          {/* 方案 3：Surge 专属安全 DoH 接管 */}
          <VStack alignment="leading">
            <Text bold font="headline">⚡️ 方案 3：Surge 专属安全 DoH (稳定极速推荐)</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">
              标准安全 DoH 接口：https://127.0.0.1:9443/dns-query，全手机 App DNS 毫秒级防污染解析与广告拦截：
            </Text>
            <Text font="caption">
              1. 确保已安装并信任 CA 根证书（下方按钮一键安装）；
            </Text>
            <Text font="caption">
              2. 点击下方「复制 Surge DoH 配置」，粘贴至 Surge 配置文件文本模式的 [General] 节点；
            </Text>
            <Text font="caption">
              3. 开启 Surge，全设备 DNS 查询瞬间由本地 18.5 万条 AdGuard 广告规则直接黑洞化！
            </Text>
          </VStack>

          <HStack>
            <Button
              title="安装 CA 根证书"
              action={installCaCert}
            />
            <Spacer />
            <Button
              title="复制 Surge DoH 配置"
              action={copySurgeDohConfig}
            />
          </HStack>

          {/* 方案 4：Shadowrocket (小火箭·免证书全局接管) */}
          <VStack alignment="leading">
            <Text bold font="headline">📱 方案 4：Shadowrocket (小火箭·免证书极速接管)</Text>
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

          {/* 方案 5：电脑 / 局域网设备接入 (家庭 DNS 防火墙) */}
          <VStack alignment="leading">
            <Text bold font="headline">💻 方案 5：电脑 / 局域网设备接入 (家庭 DNS 防火墙)</Text>
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

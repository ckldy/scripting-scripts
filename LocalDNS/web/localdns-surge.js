/**
 * LocalDNS Surge DNS Script
 * 接管 Surge 的 DNS 解析，直接交由本地 Scripting LocalDNS 处理
 * 包含：AdGuard 广告拦截、11 层分流路由、四级缓存池、多上游并发竞速
 */

const domain = $request.question ? $request.question.name : '';
const qtype = $request.question ? $request.question.type : 1;

if (!domain) {
  $done({});
} else {
  $httpClient.get({
    url: 'http://127.0.0.1:9099/api/resolve?name=' + encodeURIComponent(domain) + '&type=' + qtype,
    timeout: 3000
  }, function(error, response, data) {
    if (error || !data) {
      // 网络异常或 LocalDNS 暂停时，优雅回退到 Surge 自身上游
      $done({});
      return;
    }
    try {
      const res = JSON.parse(data);
      if (res && Array.isArray(res.addresses) && res.addresses.length > 0) {
        $done({
          addresses: res.addresses,
          ttl: res.ttl || 300
        });
        return;
      }
    } catch (e) {}
    $done({});
  });
}

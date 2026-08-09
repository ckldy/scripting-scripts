import { fetch } from "scripting"
import { decryptCBCPkcs7Hex, encryptCBCPkcs7Hex } from "./crypto-js"
import { gzip, inflate } from "./pako.min"

const MASTER_KEY = "7961beb44246e3012ce228d6b5ced05a"
const STORAGE_DEVICE = "huangdou_device_id_v1"
// 持久化用户状态（token/userId）：自动解锁后的新身份（钻石会员+999999金币）重启不丢，
// 会话过期(2002)时自动重新登录并刷新存储。
const STORAGE_LOGIN = "huangdou_login_v1"
// 强制代理（2026-08-06 用户决策）：所有请求只走本地解锁代理（127.0.0.1:8787）。
// 代理不可用时本地连接快速失败并报错，绝不回退真实线路——
// 回退会导致上游返回真实付费状态（is_buy=false/813005），UI 显示锁/无法解锁。
const LOCAL_BASE = "http://127.0.0.1:8787"

export type DramaItem = { id: string; dramaId: string; name: string; cover: string; category: string; episodeCount: string; updateLabel: string; description: string; hotRate: string; payType: string }
export type DramaEpisode = { seq: number; name: string; duration: number; cover: string; type: string; price: number; purchased: boolean }
export type DramaDetail = DramaItem & { tags: string[]; episodes: DramaEpisode[]; publisher: string; issueDate: string; freeEpisodes: number; isBuyWhole: boolean }
export type DramaPlay = { name: string; duration: number; url: string; previewUrl: string; lines: { name: string; url: string }[] }
export type DramaPage = { items: DramaItem[]; page: number; hasNext: boolean }
export type HomeBlock = { id: string; name: string; subtitle: string; items: DramaItem[] }
export type HomeCategory = { id: string; code: string; name: string }
export type HomeTab = { id: string; tab: string; name: string; filter: Record<string, string> }
export type HomeNavigation = { categories: HomeCategory[]; tabs: HomeTab[]; selectedCategory: string; selectedTab: HomeTab }

type LoginState = { userId: string; token: string }
type ApiEnvelope = { status?: string; errorCode?: number | string; error?: string; data?: any }

/** 带错误码的接口错误：code 813005=金币集未解锁、813004=VIP 专享、203001=余额不足、2001=解密失败、2002=会话过期 */
export class ApiError extends Error {
  readonly code: number
  constructor(message: string, code?: number | string) {
    super(message)
    this.code = Number(code) || 0
  }
}

class HuangdouClient {
  private sessionId = UUID.string().replace(/-/g, "").toLowerCase()
  private login: LoginState | null = null

  async getHomeNavigation(preferredCategory = ""): Promise<HomeNavigation> {
    const navData = await this.request<any>("/drama/navList", {}, true)
    const categories = array(navData?.list).map(item => ({ id: text(item?.id) || text(item?.code), code: text(item?.code), name: text(item?.name) })).filter(item => item.code && item.name)
    const selectedCategory = categories.some(item => item.code === preferredCategory) ? preferredCategory : categories[0]?.code || "yuandou"
    const filters = await this.request<any>("/drama/navFilter", { code: selectedCategory }, true)
    const tabs = withCategoryTabs(selectedCategory, parseHomeTabs(filters?.list))
    const selectedTab = tabs[0] || { id: `${selectedCategory}-default`, tab: "recommend", name: "推荐", filter: {} }
    return { categories, tabs, selectedCategory, selectedTab }
  }

  async getHomeTabs(code: string): Promise<HomeTab[]> {
    const filters = await this.request<any>("/drama/navFilter", { code }, true)
    return withCategoryTabs(code, parseHomeTabs(filters?.list))
  }

  async getHomeBlocks(code: string, selection: HomeTab, page = 1, categoryName = ""): Promise<HomeBlock[]> {
    const safePage = Math.max(1, page)
    const filter = selection.filter || {}
    const blocks: HomeBlock[] = []
    // 无 cat_id 的 tab（如「黄豆原创/推荐」）：/drama/list 不传 cat_id 只返回全站内容；
    // 该分类全部内容需用分类名搜索获取（服务端仅提供搜索方式，如 keywords=黄豆原创）。
    if (!filter.cat_id) {
      const searchParams: Record<string, string> = { page: String(safePage), page_size: "18", ...filter }
      // 推荐 tab 用分类名搜索全量；补充的二级 tab（大神精选等）自带 keywords。
      if (!searchParams.keywords && categoryName) searchParams.keywords = categoryName
      const data = await this.request<any>("/drama/list", searchParams, true)
      // 以搜索词为基准二次过滤，确保不混入其他分类内容。
      const target = searchParams.keywords || categoryName
      const items = array(data?.list).map(parseDramaItem).filter(validDrama).filter(item => !target || item.category === target)
      if (items.length) blocks.push({ id: `${code}-${selection.id}-${safePage}`, name: selection.name, subtitle: filterSubtitle(filter), items })
      return blocks
    }
    // 分页列表（/drama/list，带 filter），每页 18 部。
    const params: Record<string, string> = { page: String(safePage), page_size: "18", ...filter }
    const data = await this.request<any>("/drama/list", params, true)
    const items = array(data?.list).map(parseDramaItem).filter(validDrama)
    return items.length ? [{ id: `${code}-${selection.id}-${safePage}`, name: selection.name, subtitle: filterSubtitle(filter), items }] : []
  }

  async list(page = 1, keywords = ""): Promise<DramaPage> {
    const pageSize = 20
    const data: Record<string, string> = { page: String(Math.max(1, page)), page_size: String(pageSize) }
    if (keywords.trim()) data.keywords = keywords.trim()
    const result = await this.request<any>("/drama/list", data, true)
    const items = array(result?.list).map(parseDramaItem).filter(validDrama)
    return { items, page: Math.max(1, page), hasNext: items.length >= pageSize }
  }

  async detail(id: string): Promise<DramaDetail> {
    const raw = await this.request<any>("/drama/detail", { id }, true)
    const base = parseDramaItem({ ...raw, img_y: raw?.img_y || raw?.img, img_x: raw?.img_x || raw?.img })
    return { ...base, tags: array(raw?.tags).map(text).filter(Boolean), publisher: text(raw?.publisher), issueDate: text(raw?.issue_date), freeEpisodes: number(raw?.free_episodes), isBuyWhole: bool(raw?.is_buy_whole, false), episodes: array(raw?.episodes).map(item => ({ seq: number(item?.seq), name: text(item?.name) || `第 ${number(item?.seq)} 集`, duration: number(item?.duration), cover: text(item?.cover), type: text(item?.type) || "free", price: number(item?.price), purchased: bool(item?.is_buy, true) })).filter(item => item.seq > 0) }
  }

  /** 只读查询当前用户状态：金币余额 / VIP 会员等（用于账号展示）。 */
  async userInfo(): Promise<{ userId: string; balance: number; isVip: boolean; raw: any }> {
    const data = await this.request<any>("/user/info", {}, true)
    return { userId: text(data?.user_id), balance: number(data?.balance ?? data?.gold ?? data?.coin), isVip: bool(data?.is_vip, false), raw: data }
  }

  /** 诊断用：探测任意接口的原始返回。 */
  async probe(path: string, data: unknown = {}): Promise<any> {
    return this.request<any>(path, data, true)
  }

  /** 金币解锁：method="coin"（单集金币）/ "whole"（买断全集）；成功返回 true。 */
  async buy(id: string, seq: number, method = "coin"): Promise<boolean> {
    const res = await this.request<any>("/drama/doBuy", { id, seq: String(seq), method }, true)
    return Boolean(res?.status === "y" || res?.status === true)
  }

  /**
   * 重置设备身份：清除持久化 deviceId 与用户状态并强制重新登录。
   * 新身份首次签到可得 VIP 1天（旧「新设备礼包」机制已失效，见 playWithAutoUnlock）。
   */
  async resetIdentity(): Promise<void> {
    Storage.remove(STORAGE_DEVICE)
    this.clearLogin()
  }

  async play(id: string, seq: number): Promise<DramaPlay> {
    return this.playWithAutoUnlock(id, seq, 0)
  }

  /**
   * 自动解锁播放状态机（stage 0→4，最多 4 次重试）：
   *   0. 付费墙(813005/813004) → 当前身份签到（第1天=VIP 1天，可直接放行 VIP 剧）
   *   1. 仍被墙 → 金币集且有金币则 doBuy 解锁；否则换新设备身份
   *   2. 新身份播被墙 → 新身份签到（新身份第 1 天同样=VIP 1天）
   *   3. 最后重试一次，仍失败则抛原始错误
   * 用户状态（token/userId）持久化，重启不丢；会话过期(2002)自动重登。
   */
  private async playWithAutoUnlock(id: string, seq: number, stage: number): Promise<DramaPlay> {
    try {
      return await this.rawPlay(id, seq)
    } catch (error) {
      if (!(error instanceof ApiError) || (error.code !== 813005 && error.code !== 813004) || stage >= 3) throw error
      if (stage === 0 || stage === 2) { try { await this.request<any>("/user/doSign", {}, true) } catch { /* 已签到则忽略 */ } }
      if (stage === 1 && error.code === 813005) { try { await this.buy(id, seq, "coin") } catch { /* 金币不足则忽略 */ } }
      if (stage === 1) { await this.resetIdentity() }
      return this.playWithAutoUnlock(id, seq, stage + 1)
    }
  }

  private async rawPlay(id: string, seq: number): Promise<DramaPlay> {
    const raw = await this.request<any>("/drama/play", { id, seq: String(seq) }, true)
    const lines = array(raw?.lines).map(item => ({ name: text(item?.name) || "备用线路", url: text(item?.url) })).filter(item => /^https?:\/\//i.test(item.url))
    const previewUrl = text(raw?.preview_m3u8)
    const url = text(raw?.m3u8) || lines[0]?.url || previewUrl || ""
    if (!/^https?:\/\//i.test(url)) throw new Error("当前剧集没有可用的播放地址，可能需要会员或购买权限。")
    return { name: text(raw?.name) || `第 ${seq} 集`, duration: number(raw?.duration), url, previewUrl, lines }
  }

  playbackHeaders(resourceUrl: string): Record<string, string> {
    return { Referer: "https://lzlukvca.cc/", Origin: "https://lzlukvca.cc", "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", Accept: "*/*" }
  }

  private async ensureLogin(force = false): Promise<void> {
    if (this.login && !force) return
    const saved = Storage.get<LoginState>(STORAGE_LOGIN)
    if (saved?.userId && saved?.token && !force) {
      this.login = { userId: saved.userId, token: saved.token }
      return
    }
    // 登录自检：强制走本地代理（与 request 一致，不回退真实线路）
    try {
      const data = await this.rawRequest<any>("/login/device", { line_code: "local", channel_code: "", share_code: "", clipboard_text: "", device_info: { browserName: "BrowserName.safari", language: "zh-CN", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPhone" } }, "")
      const userId = text(data?.user_id)
      const token = text(data?.token)
      if (!userId || !token) throw new Error("匿名设备会话创建失败。")
      this.login = { userId, token }
      Storage.set(STORAGE_LOGIN, this.login)
      return
    } catch (error) {
      throw error instanceof Error ? error : new Error("匿名设备会话创建失败。")
    }
  }

  private clearLogin(): void {
    this.login = null
    Storage.remove(STORAGE_LOGIN)
  }

  private async request<T>(path: string, data: unknown, auth: boolean, retry = 0): Promise<T> {
    // 强制代理：所有请求只走本地代理。代理不可用直接报错，绝不回退真实线路——
    // 回退会导致上游返回真实付费状态（is_buy=false/813005），客户端拿到错误数据（显示锁/无法解锁）。
    try {
      if (auth) await this.ensureLogin()
      const token = auth && this.login ? `${this.login.token}_${this.login.userId}` : ""
      return await this.rawRequest<T>(path, data, token)
    } catch (error) {
      if (error instanceof AuthExpiredError && retry < 1) { this.clearLogin(); await this.ensureLogin(true); return this.request(path, data, auth, retry + 1) }
      const reason = error instanceof Error ? error.message : "未知错误"
      throw new Error(`本地解锁代理不可用，请重新运行脚本后再试。(${reason})`)
    }
  }

  private async rawRequest<T>(path: string, data: unknown, token: string): Promise<T> {
    const url = `${LOCAL_BASE}/api${path}`
    const requestId = UUID.string().toLowerCase()
    const key = deriveKey(requestId)
    const iv = Crypto.generateSymmetricKey(128).toHexString()
    const jsonData = requiredData(Data.fromString(JSON.stringify({ token, deviceId: deviceId(), data })))
    const jsonBytes = new Uint8Array(jsonData.toArrayBuffer())
    const plaintext = hex(gzip(jsonBytes))
    const encrypted = encryptCBCPkcs7Hex(plaintext, key, iv)
    const body = dataFromHex(iv + encrypted)
    const time = Math.floor(Date.now() / 1000)
    const signSource = `Dart|${this.sessionId}|${requestId}|${time}|${url.replace(/^https?:\/\//, "")}`
    // 超时保护：网络异常/风控时避免 fetch 无限挂起（iOS fetch 无默认超时）。
    // 30s：给代理内多条上游线路（6s/条）留足换线时间，降低网络抖动时的整体失败率。
    const response = await withTimeout(30000, fetch(url, { method: "POST", headers: { version: "1.0.0", deviceType: "web", time: String(time), sign: `${Crypto.md5(requiredData(Data.fromString(signSource))).toHexString()}-${time}`, requestId, sessionId: this.sessionId, deviceBrand: "", deviceModel: "", systemName: "", systemVersion: "", "Content-Type": "application/x-www-form-urlencoded" }, body }))
    if (!response.ok) throw new Error(`内容服务暂时不可用（${response.status}），请稍后重试。`)
    const bytes = new Uint8Array(requiredData(await response.data()).toArrayBuffer())
    if (bytes.length < 32) throw new Error("服务器响应数据无效。")
    const responseIv = hex(bytes.slice(0, 16))
    const decryptedHex = decryptCBCPkcs7Hex(hex(bytes.slice(16)), key, responseIv)
    const decrypted = new Uint8Array(dataFromHex(decryptedHex).toArrayBuffer())
    const plain = isCompressedPayload(decrypted) ? inflate(decrypted) : decrypted
    let envelope: ApiEnvelope
    try { envelope = JSON.parse(new TextDecoder().decode(plain)) as ApiEnvelope }
    catch { throw new Error("内容服务返回的数据无法读取，请稍后重试。") }
    if (envelope.status === "n") {
      const code = Number(envelope.errorCode) || 0
      if (code === 2002) throw new AuthExpiredError(envelope.error || "设备会话已过期。")
      throw new ApiError(envelope.error || "黃豆短劇内容服务返回错误。", code)
    }
    return (envelope.data ?? null) as T
  }
}

class AuthExpiredError extends Error {}
export const huangdouClient = new HuangdouClient()

function withTimeout<T>(ms: number, promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`请求超时（${ms / 1000}s），请稍后重试。`)), ms)
    promise.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}

function deriveKey(requestId: string): string { return Crypto.hmacSHA256(dataFromHex(requestId.replace(/-/g, "")), requiredData(Data.fromString(MASTER_KEY))).toHexString() }
function deviceId(): string { const value = Storage.get<string>(STORAGE_DEVICE); if (value) return value; const created = UUID.string().toLowerCase(); Storage.set(STORAGE_DEVICE, created); return created }
function requiredData(value: Data | null): Data { if (!value) throw new Error("内容数据处理失败，请稍后重试。"); return value }
function dataFromHex(value: string): Data { const bytes = new Uint8Array(Math.floor(value.length / 2)); for (let index = 0; index < bytes.length; index++) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16); const data = Data.fromArrayBuffer(bytes.buffer); if (!data) throw new Error("内容数据转换失败，请稍后重试。"); return data }
function hex(value: Uint8Array): string { return Array.from(value, byte => byte.toString(16).padStart(2, "0")).join("") }
function isCompressedPayload(value: Uint8Array): boolean { if (value.length < 2) return false; if (value[0] === 0x1f && value[1] === 0x8b) return true; return value[0] === 0x78 && (((value[0] << 8) | value[1]) % 31 === 0) }
function stringRecord(value: any): Record<string, string> { const result: Record<string, string> = {}; if (!value || typeof value !== "object" || Array.isArray(value)) return result; for (const key of Object.keys(value)) result[key] = text(value[key]); return result }
function parseHomeTabs(value: any): HomeTab[] { return array(value).map((item, index) => { const filter = stringRecord(item?.filter); const tab = text(item?.tab); return { id: tab || [filter.cat_id, filter.tag_id, filter.order, index].filter(Boolean).join("-"), tab, name: text(item?.name) || "全部", filter } }).filter(item => item.id) }

/**
 * 黄豆原创（yuandou）服务端无二级分类（navFilter 仅返回推荐 tab，无 cat_id），
 * 但其内容按 content category 区分（大神精选/单体作品/影视魔改）。
 * 客户端按分类名补充搜索 tab，用 /drama/list 的 keywords 拉取对应内容。
 */
function withCategoryTabs(code: string, tabs: HomeTab[]): HomeTab[] {
  if (code !== "yuandou") return tabs
  const extra: HomeTab[] = [
    { id: "yuandou-dashen", tab: "dashen", name: "大神精选", filter: { keywords: "大神精选" } },
    { id: "yuandou-danti", tab: "danti", name: "单体作品", filter: { keywords: "单体作品" } },
    { id: "yuandou-yingshi", tab: "yingshi", name: "影视魔改", filter: { keywords: "影视魔改" } },
  ]
  return [...tabs, ...extra]
}
function filterSubtitle(filter: Record<string, string>): string { if (filter.order === "hot") return "按热度排序"; if (filter.order === "new") return "最近更新"; return "全部内容" }
function array(value: any): any[] { return Array.isArray(value) ? value : [] }
function text(value: any): string { return value == null ? "" : String(value) }
function number(value: any): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0 }
function bool(value: any, fallback = false): boolean { if (value == null) return fallback; return value === true || value === 1 || value === "1" || value === "y" || value === "true" }
function validDrama(item: DramaItem): boolean { return Boolean(item.id && item.name) }
function parseDramaItem(raw: any): DramaItem { return { id: text(raw?.id) || text(raw?.drama_id).replace(/^[^_]+_/, ""), dramaId: text(raw?.drama_id) || text(raw?.id), name: text(raw?.name), cover: text(raw?.img_y) || text(raw?.img) || text(raw?.img_x), category: text(raw?.category), episodeCount: text(raw?.episode_count), updateLabel: text(raw?.update_label), description: text(raw?.description), hotRate: text(raw?.hot_rate), payType: text(raw?.pay_type) } }

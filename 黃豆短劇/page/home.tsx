import { Button, HStack, Image, LazyHStack, LazyVGrid, ProgressView, ScrollView, ScrollViewReader, Text, VStack, ZStack, useEffect, useObservable, useRef, useState, type ScrollViewProxy } from "scripting"
import { huangdouClient, type DramaItem, type HomeBlock, type HomeCategory, type HomeTab } from "../client"
import { ACCENT, GRID_SPACING, LoadingState, PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, Pagination, SECTION_SPACING, SectionHeading, StateCard } from "../design"
import { DiscoverDramaCard } from "./discover-card"
import { DetailPage } from "./detail"

export function HomePageContent({ onLibraryChanged }: { onLibraryChanged: () => void }) {
  const [categories, setCategories] = useState<HomeCategory[]>([])
  const [tabs, setTabs] = useState<HomeTab[]>([])
  const [category, setCategory] = useState("")
  const [tab, setTab] = useState<HomeTab | null>(null)
  const [blocks, setBlocks] = useState<HomeBlock[]>([])
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(true)
  const [filterLoading, setFilterLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<DramaItem | null>(null)
  const presented = useObservable(false)
  const generation = useRef(0)
  const scrollProxy = useRef<ScrollViewProxy | null>(null)

  async function bootstrap() {
    const current = ++generation.current
    setLoading(true); setError(null)
    try {
      const navigation = await huangdouClient.getHomeNavigation(category)
      if (current !== generation.current) return
      setCategories(navigation.categories); setTabs(navigation.tabs)
      setCategory(navigation.selectedCategory); setTab(navigation.selectedTab)
      setPage(1)
      const nextBlocks = await huangdouClient.getHomeBlocks(navigation.selectedCategory, navigation.selectedTab, 1, navigation.categories.find(item => item.code === navigation.selectedCategory)?.name || "")
      if (current !== generation.current) return
      setBlocks(nextBlocks)
      setHasNext(hasMore(nextBlocks))
    } catch (reason) { if (current === generation.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (current === generation.current) setLoading(false) }
  }
  async function selectCategory(nextCategory: string) {
    if (nextCategory === category || filterLoading) return
    const current = ++generation.current
    setCategory(nextCategory); setFilterLoading(true); setError(null)
    try {
      const nextTabs = await huangdouClient.getHomeTabs(nextCategory)
      const nextTab = nextTabs[0] || { id: `${nextCategory}-default`, tab: "recommend", name: "推荐", filter: {} }
      setPage(1)
      const nextBlocks = await huangdouClient.getHomeBlocks(nextCategory, nextTab, 1, categoryNameOf(nextCategory))
      if (current !== generation.current) return
      setTabs(nextTabs); setTab(nextTab); setBlocks(nextBlocks)
      setHasNext(hasMore(nextBlocks))
    } catch (reason) { if (current === generation.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (current === generation.current) setFilterLoading(false) }
  }
  async function selectTab(nextTab: HomeTab) {
    if (nextTab.id === tab?.id || filterLoading || !category) return
    const current = ++generation.current
    setTab(nextTab); setFilterLoading(true); setError(null)
    setPage(1)
    try { const nextBlocks = await huangdouClient.getHomeBlocks(category, nextTab, 1, categoryNameOf(category)); if (current === generation.current) { setBlocks(nextBlocks); setHasNext(hasMore(nextBlocks)) } }
    catch (reason) { if (current === generation.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (current === generation.current) setFilterLoading(false) }
  }
  async function loadPage(nextPage: number) {
    if (!tab || !category || filterLoading) return
    const current = ++generation.current
    setFilterLoading(true); setError(null)
    try { const nextBlocks = await huangdouClient.getHomeBlocks(category, tab, nextPage, categoryNameOf(category)); if (current === generation.current) { setPage(nextPage); setBlocks(nextBlocks); setHasNext(hasMore(nextBlocks)) } }
    catch (reason) { if (current === generation.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (current === generation.current) setFilterLoading(false) }
  }
  async function refresh() {
    if (!category) return bootstrap()
    const current = ++generation.current
    setFilterLoading(true); setError(null)
    setPage(1)
    try { if (!tab) return; const nextBlocks = await huangdouClient.getHomeBlocks(category, tab, 1, categoryNameOf(category)); if (current === generation.current) { setBlocks(nextBlocks); setHasNext(hasMore(nextBlocks)) } }
    catch (reason) { if (current === generation.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (current === generation.current) setFilterLoading(false) }
  }
  useEffect(() => { void bootstrap() }, [])
  function open(drama: DramaItem) { setSelected(drama); presented.setValue(true) }
  function categoryNameOf(code: string): string {
    return categories.find(item => item.code === code)?.name || ""
  }
  // 满 18 部才允许继续翻页；不足 18 部即为当前筛选的最后一页。
  function hasMore(nextBlocks: HomeBlock[]): boolean {
    return nextBlocks.some(block => block.items.length >= 18)
  }
  useEffect(() => { if (blocks.length) scrollProxy.current?.scrollTo("home-results-top", "top") }, [page])

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}><PageBackground /><ScrollViewReader>{proxy => { scrollProxy.current = proxy; return <ScrollView navigationTitle="黃豆短劇" navigationBarTitleDisplayMode="large" refreshable={refresh} navigationDestination={{ isPresented: presented, content: selected ? <DetailPage drama={selected} onLibraryChanged={onLibraryChanged} /> : <VStack /> }}><VStack key="home-results-top" spacing={SECTION_SPACING} alignment="leading" padding={{ top: 8, bottom: PAGE_BOTTOM_PADDING }}>
    {categories.length ? <VStack spacing={11} alignment="leading" frame={{ maxWidth: "infinity" }}><Text font="caption" fontWeight="semibold" foregroundStyle="secondaryLabel" padding={{ horizontal: PAGE_PADDING }}>内容分类</Text><ScrollView axes="horizontal" scrollIndicator="hidden"><LazyHStack spacing={9} padding={{ horizontal: PAGE_PADDING }}>{categories.map(item => <FilterChip key={item.code} title={item.name} selected={item.code === category} disabled={filterLoading} action={() => { void selectCategory(item.code) }} />)}</LazyHStack></ScrollView>{tabs.length > 1 ? <ScrollView axes="horizontal" scrollIndicator="hidden"><LazyHStack spacing={9} padding={{ horizontal: PAGE_PADDING }}>{tabs.map(item => <FilterChip key={item.id} title={item.name} selected={item.id === tab?.id} secondary disabled={filterLoading} action={() => { void selectTab(item) }} />)}</LazyHStack></ScrollView> : undefined}</VStack> : undefined}
    {filterLoading && blocks.length ? <HStack spacing={8} padding={{ horizontal: PAGE_PADDING }}><ProgressView progressViewStyle="circular" tint={ACCENT} /><Text font="footnote" foregroundStyle="secondaryLabel">正在加载第 {page} 页</Text></HStack> : undefined}
    {loading && !blocks.length ? <LoadingState title="正在加载首页内容" minHeight={360} /> : error && !blocks.length ? <VStack padding={{ horizontal: PAGE_PADDING }}><StateCard title="首页加载失败" description={error} systemImage="wifi.exclamationmark" tint="systemRed" actionTitle="重新加载" action={() => { void bootstrap() }} /></VStack> : !blocks.length ? <VStack padding={{ horizontal: PAGE_PADDING }}><StateCard title="暂无首页内容" description="当前分类没有返回可展示的短剧。" systemImage="rectangle.stack.badge.minus" actionTitle="刷新" action={() => { void refresh() }} /></VStack> : blocks.map(block => <VStack key={`${category}-${tab?.id || "default"}-${block.id}`} spacing={12} alignment="leading" padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity" }}><SectionHeading title={block.name} subtitle={block.subtitle} /><LazyVGrid columns={[{ size: { type: "flexible" }, spacing: GRID_SPACING, alignment: "leading" }, { size: { type: "flexible" }, spacing: GRID_SPACING, alignment: "leading" }, { size: { type: "flexible" }, alignment: "leading" }]} alignment="leading" spacing={20} frame={{ maxWidth: "infinity", alignment: "leading" }}>{block.items.map(drama => <DiscoverDramaCard key={drama.id} drama={drama} onOpen={open} />)}</LazyVGrid></VStack>)}
    {error && blocks.length ? <VStack padding={{ horizontal: PAGE_PADDING }}><StateCard title="分类刷新失败" description={error} systemImage="exclamationmark.arrow.triangle.2.circlepath" tint="systemOrange" /></VStack> : undefined}
    {blocks.length ? <VStack padding={{ horizontal: PAGE_PADDING }}><Pagination page={page} hasNext={hasNext} loading={filterLoading} onPrevious={() => { void loadPage(page - 1) }} onNext={() => { void loadPage(page + 1) }} /></VStack> : undefined}
  </VStack></ScrollView>}}</ScrollViewReader></ZStack>
}

function FilterChip({ title, selected, secondary = false, disabled, action }: { title: string; selected: boolean; secondary?: boolean; disabled: boolean; action: () => void }) {
  return <Button action={action} disabled={disabled} buttonStyle="plain" contentShape="capsule" accessibilityLabel={`${title}${selected ? "，已选择" : ""}`}><HStack spacing={6} padding={{ horizontal: 14, vertical: 9 }} background={selected ? ACCENT : secondary ? "secondarySystemFill" : "tertiarySystemFill"} clipShape="capsule">{selected ? <Image systemName="checkmark" font="caption2" fontWeight="bold" foregroundStyle="black" /> : undefined}<Text font="subheadline" fontWeight={selected ? "semibold" : "regular"} foregroundStyle={selected ? "black" : "label"}>{title}</Text></HStack></Button>
}

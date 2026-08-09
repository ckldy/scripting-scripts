import { LazyVGrid, ScrollView, ScrollViewReader, VStack, ZStack, useEffect, useObservable, useRef, useState, type ScrollViewProxy } from "scripting"
import { huangdouClient, type DramaItem } from "../client"
import { LoadingState, PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, Pagination, StateCard } from "../design"

import { DiscoverDramaCard } from "./discover-card"
import { DetailPage } from "./detail"

export function DiscoverPage({ onLibraryChanged }: { onLibraryChanged: () => void }) {
  const [items, setItems] = useState<DramaItem[]>([]), [page, setPage] = useState(1), [hasNext, setHasNext] = useState(true), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [selected, setSelected] = useState<DramaItem | null>(null)
  const presented = useObservable(false)
  const scrollProxy = useRef<ScrollViewProxy | null>(null)
  async function load(nextPage = page) { setLoading(true); setError(null); try { const result = await huangdouClient.list(nextPage); setItems(result.items); setPage(result.page); setHasNext(result.hasNext) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setLoading(false) } }
  useEffect(() => { void load(1) }, [])
  useEffect(() => { if (items.length) scrollProxy.current?.scrollTo("discover-results-top", "top") }, [page])
  function open(drama: DramaItem) { setSelected(drama); presented.setValue(true) }
  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}><PageBackground /><ScrollViewReader>{proxy => { scrollProxy.current = proxy; return <ScrollView navigationTitle="发现" navigationBarTitleDisplayMode="large" refreshable={() => load(page)} navigationDestination={{ isPresented: presented, content: selected ? <DetailPage drama={selected} onLibraryChanged={onLibraryChanged} /> : <VStack /> }}><VStack key="discover-results-top" spacing={20} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 8, bottom: PAGE_BOTTOM_PADDING }}>{loading && !items.length ? <LoadingState title="正在加载发现内容" minHeight={420} /> : error && !items.length ? <StateCard title="发现加载失败" description={error} systemImage="wifi.exclamationmark" tint="systemRed" actionTitle="重新加载" action={() => { void load(page) }} /> : !items.length ? <StateCard title="暂无短剧" description="当前页面没有返回可浏览的短剧。" systemImage="rectangle.stack.badge.minus" actionTitle="刷新" action={() => { void load(page) }} /> : <LazyVGrid columns={[{ size: { type: "flexible" }, spacing: PAGE_PADDING, alignment: "leading" }, { size: { type: "flexible" }, spacing: PAGE_PADDING, alignment: "leading" }]} alignment="leading" spacing={20} frame={{ maxWidth: "infinity", alignment: "leading" }}>{items.map(drama => <DiscoverDramaCard key={drama.id} drama={drama} onOpen={open} />)}</LazyVGrid>}{error && items.length ? <StateCard title="刷新失败" description="正在显示上次成功加载的内容。" systemImage="exclamationmark.arrow.triangle.2.circlepath" tint="systemOrange" actionTitle="重试" action={() => { void load(page) }} /> : undefined}{items.length ? <Pagination page={page} hasNext={hasNext} loading={loading} onPrevious={() => { void load(page - 1) }} onNext={() => { void load(page + 1) }} /> : undefined}</VStack></ScrollView>}}</ScrollViewReader></ZStack>
}

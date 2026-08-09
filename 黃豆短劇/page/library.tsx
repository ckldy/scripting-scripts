import { Button, ScrollView, VStack, ZStack, useObservable, useState } from "scripting"
import type { DramaItem } from "../client"
import { PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, SECTION_SPACING, SectionHeading, StateCard } from "../design"
import { clearHistory, loadFavourites, loadHistory } from "../storage"
import { DramaRowList } from "./components"
import { DetailPage } from "./detail"

export function LibraryPage({ revision, onLibraryChanged }: { revision: number; onLibraryChanged: () => void }) {
  const [selected, setSelected] = useState<DramaItem | null>(null), presented = useObservable(false)
  const favourites = loadFavourites(), history = loadHistory()
  function open(drama: DramaItem) { setSelected(drama); presented.setValue(true) }
  const historySubtitle = new Map(history.map(item => [item.drama.id, `${item.episodeName} · ${new Date(item.playedAt).toLocaleDateString()}`]))
  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}><PageBackground /><ScrollView navigationTitle="资料库" navigationBarTitleDisplayMode="large" navigationDestination={{ isPresented: presented, content: selected ? <DetailPage drama={selected} onLibraryChanged={onLibraryChanged} /> : <VStack /> }}><VStack key={String(revision)} spacing={SECTION_SPACING} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 8, bottom: PAGE_BOTTOM_PADDING }}><VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}><SectionHeading title="收藏" subtitle={`${favourites.length} 部短剧 · 仅保存在本机`} />{favourites.length ? <DramaRowList items={favourites} onOpen={open} /> : <StateCard title="暂无收藏" description="在短剧详情页选择收藏后，会直接显示在这里。" systemImage="heart" />}</VStack><VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}><SectionHeading title="播放历史" subtitle={`${history.length} 条记录 · 按最近播放排序`} />{history.length ? <DramaRowList items={history.map(item => item.drama)} subtitle={drama => historySubtitle.get(drama.id)} onOpen={open} /> : <StateCard title="暂无播放记录" description="播放剧集后，最近观看记录会显示在这里。" systemImage="clock.arrow.circlepath" />}{history.length ? <Button title="清除播放历史" systemImage="trash" tint="systemRed" frame={{ maxWidth: "infinity", minHeight: 44 }} action={() => { clearHistory(); onLibraryChanged() }} /> : undefined}</VStack></VStack></ScrollView></ZStack>
}

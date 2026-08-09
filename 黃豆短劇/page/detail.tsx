import { Button, HStack, Image, LazyVGrid, ProgressView, ScrollView, Text, VStack, ZStack, useEffect, useState } from "scripting"
import { huangdouClient, ApiError, type DramaDetail, type DramaEpisode, type DramaItem } from "../client"
import { ACCENT, GRID_SPACING, LoadingState, PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, SectionHeading, StateCard } from "../design"
import { presentEpisodePlayer } from "../episode-player"
import { DramaArtwork } from "./components"
import { isFavourite, toggleFavourite } from "../storage"

export function DetailPage({ drama, onLibraryChanged }: { drama: DramaItem; onLibraryChanged: () => void }) {
  const [detail, setDetail] = useState<DramaDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [favourite, setFavourite] = useState(() => isFavourite(drama.id))
  const [playing, setPlaying] = useState<number | null>(null)
  async function load() { setLoading(true); setError(null); try { setDetail(await huangdouClient.detail(drama.id)) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setLoading(false) } }
  useEffect(() => { void load() }, [drama.id])
  async function playCore(episode: DramaEpisode): Promise<void> {
    await presentEpisodePlayer({ drama, episodes: resolved.episodes, startSeq: episode.seq, onLibraryChanged })
  }
  async function play(episode: DramaEpisode, retried = false) { if (playing !== null) return; setPlaying(episode.seq); try { await playCore(episode) } catch (reason) { const code = reason instanceof ApiError ? reason.code : 0; if (!retried && (code === 813005 || code === 813004 || code === 203001)) { try { await huangdouClient.resetIdentity(); await playCore(episode) } catch (second) { await handlePlayError(episode, second) } } else { await handlePlayError(episode, reason) } } finally { setPlaying(null) } }
  /** 播放失败处理：自动解锁重试失败后，金币集弹确认解锁（doBuy），VIP 集提示开通会员 */
  async function handlePlayError(episode: DramaEpisode, reason: unknown) {
    const message = reason instanceof Error ? reason.message : String(reason)
    const code = reason instanceof ApiError ? reason.code : 0
    if (code === 813005) {
      const price = episode.price > 0 ? episode.price : 0
      const confirmed = await Dialog.confirm({ title: "本集需金币解锁", message: `本集需 ${price} 金币解锁，确认解锁本集？`, cancelLabel: "取消", confirmLabel: "解锁" })
      if (!confirmed) return
      try {
        const bought = await huangdouClient.buy(drama.id, episode.seq, "coin")
        if (bought) { await play(episode); return }
        await Dialog.alert({ title: "解锁失败", message: "解锁未成功，请稍后重试。" })
      } catch (buyError) {
        if (buyError instanceof ApiError && buyError.code === 203001) {
          await Dialog.alert({ title: "金币不足", message: "金币不足，请前往充值后解锁本集。" })
        } else {
          await Dialog.alert({ title: "解锁失败", message: buyError instanceof Error ? buyError.message : String(buyError) })
        }
      }
      return
    }
    if (code === 813004) {
      await Dialog.alert({ title: "VIP 专享", message: "该短剧为 VIP 专享，开通会员后即可观看。" })
      return
    }
    await Dialog.alert({ title: "播放失败", message })
  }
  function changeFavourite() { const next = toggleFavourite(drama); setFavourite(next); onLibraryChanged() }
  const resolved = detail ?? { ...drama, tags: [], episodes: [], publisher: "", issueDate: "", freeEpisodes: 0, isBuyWhole: false }
  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}><PageBackground /><ScrollView navigationTitle="短剧详情" navigationBarTitleDisplayMode="inline" refreshable={load}><VStack spacing={22} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 10, bottom: PAGE_BOTTOM_PADDING }}>
    <HStack spacing={16} alignment="top" frame={{ maxWidth: "infinity" }}><DramaArtwork drama={resolved} width={126} height={168} /><VStack spacing={8} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><Text font="title2" fontWeight="bold" lineLimit={5} multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{resolved.name}</Text><Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={3} multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{[resolved.category, resolved.episodeCount ? `${resolved.episodeCount} 集` : "", resolved.updateLabel].filter(Boolean).join(" · ") || "短剧"}</Text><Button title={favourite ? "已收藏" : "收藏"} systemImage={favourite ? "heart.fill" : "heart"} tint={favourite ? "systemRed" : ACCENT} frame={{ minHeight: 44 }} action={changeFavourite} /></VStack></HStack>
    {resolved.description ? <VStack spacing={8} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}><SectionHeading title="剧情简介" /><Text font="body" foregroundStyle="secondaryLabel" multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{resolved.description}</Text></VStack> : undefined}
    {loading ? <LoadingState title="正在加载剧集" minHeight={180} /> : error ? <StateCard title="详情加载失败" description={error} systemImage="wifi.exclamationmark" tint="systemRed" actionTitle="重新加载" action={() => { void load() }} /> : <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}><SectionHeading title="选集" subtitle={resolved.episodes.length ? `共 ${resolved.episodes.length} 集，选择剧集开始播放` : undefined} /><LazyVGrid columns={[{ size: { type: "flexible" }, spacing: GRID_SPACING }, { size: { type: "flexible" }, spacing: GRID_SPACING }]} alignment="leading" spacing={10} frame={{ maxWidth: "infinity" }}>{resolved.episodes.map(episode => <Button key={String(episode.seq)} action={() => { void play(episode) }} disabled={playing !== null} buttonStyle="bordered" tint={episode.purchased || episode.type === "free" ? ACCENT : "secondaryLabel"} frame={{ maxWidth: "infinity", minHeight: 46 }} accessibilityLabel={`${episode.name || `第 ${episode.seq} 集`}${episode.purchased || episode.type === "free" ? "，可播放" : "，可能需要购买"}`}><HStack spacing={6} frame={{ maxWidth: "infinity", alignment: "center" }}>{playing === episode.seq ? <ProgressView progressViewStyle="circular" tint={ACCENT} /> : !episode.purchased && episode.type !== "free" ? <Image systemName="lock.fill" font="caption2" /> : <Image systemName="play.fill" font="caption2" />}<Text font="subheadline" fontWeight="medium" lineLimit={2} multilineTextAlignment="center">{episode.name || `第 ${episode.seq} 集`}</Text></HStack></Button>)}</LazyVGrid>{!resolved.episodes.length ? <StateCard title="暂无剧集" description="当前详情没有返回可选剧集，可下拉刷新后重试。" systemImage="rectangle.stack.badge.minus" actionTitle="刷新" action={() => { void load() }} /> : undefined}</VStack>}
  </VStack></ScrollView></ZStack>
}

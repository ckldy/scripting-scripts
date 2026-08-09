import { Button, Divider, HStack, Image, Text, VStack, ZStack } from "scripting"
import type { DramaItem } from "../client"
import { COVER_RADIUS, GRID_COVER_HEIGHT, ROW_COVER_HEIGHT, ROW_COVER_WIDTH } from "../design"

function payLabel(payType?: string) {
  if (!payType) return ""
  return payType === "free" ? "免费" : payType === "vip" ? "会员" : payType === "money" ? "金币" : payType
}

export function DramaArtwork(props: { drama: DramaItem; width?: number; height: number; radius?: number; showsBadge?: boolean; contentMode?: "fill" | "fit" }) {
  const frame = props.width ? { width: props.width, height: props.height } : { maxWidth: "infinity" as const, height: props.height }
  const badge = props.showsBadge === false ? "" : payLabel(props.drama.payType)
  return <ZStack frame={frame} background={props.drama.cover ? undefined : "tertiarySystemFill"} clipShape={{ type: "rect", cornerRadius: props.radius ?? COVER_RADIUS, style: "continuous" }}>
    {props.drama.cover ? <Image imageUrl={props.drama.cover} resizable aspectRatio={{ contentMode: props.contentMode ?? "fill" }} frame={frame} clipped={props.contentMode !== "fit"} /> : <Image systemName="play.rectangle" font="title2" foregroundStyle="tertiaryLabel" />}
    {badge ? <HStack frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topTrailing" }} padding={8}><Text font="caption2" fontWeight="bold" foregroundStyle="white" padding={{ horizontal: 8, vertical: 4 }} background="rgba(0,0,0,0.72)" clipShape="capsule">{badge}</Text></HStack> : undefined}
  </ZStack>
}

export function DramaCard({ drama, onOpen, width, coverHeight = GRID_COVER_HEIGHT, coverContentMode = "fill" }: { drama: DramaItem; onOpen: (drama: DramaItem) => void; width?: number; coverHeight?: number; coverContentMode?: "fill" | "fit" }) {
  const meta = [drama.category, drama.episodeCount ? `${drama.episodeCount} 集` : "", drama.updateLabel].filter(Boolean).join(" · ")
  const cardHeight = coverHeight + 69
  const cardFrame = width ? { width, height: cardHeight, alignment: "topLeading" as const } : { maxWidth: "infinity" as const, height: cardHeight, alignment: "topLeading" as const }
  const textFrame = width ? { width, alignment: "topLeading" as const } : { maxWidth: "infinity" as const, alignment: "topLeading" as const }
  return <Button action={() => onOpen(drama)} buttonStyle="plain" contentShape="rect" frame={cardFrame} accessibilityLabel={[drama.name, meta, "打开详情"].filter(Boolean).join("，")}>
    <VStack spacing={7} alignment="leading" frame={cardFrame}>
      <DramaArtwork drama={drama} width={width} height={coverHeight} contentMode={coverContentMode} />
      <Text font="subheadline" fontWeight="semibold" lineLimit={2} multilineTextAlignment="leading" frame={{ ...textFrame, height: 38 }}>{drama.name}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1} frame={{ ...textFrame, height: 17, alignment: "leading" }}>{meta || "短剧"}</Text>
    </VStack>
  </Button>
}

export function DramaRow({ drama, subtitle, onOpen }: { drama: DramaItem; subtitle?: string; onOpen: (drama: DramaItem) => void }) {
  const metadata = subtitle || [drama.category, drama.episodeCount ? `${drama.episodeCount} 集` : "", drama.updateLabel].filter(Boolean).join(" · ")
  return <Button action={() => onOpen(drama)} buttonStyle="plain" contentShape="rect" frame={{ maxWidth: "infinity" }} accessibilityLabel={[drama.name, metadata, "打开详情"].filter(Boolean).join("，")}>
    <HStack spacing={12} alignment="center" padding={{ vertical: 11 }} frame={{ maxWidth: "infinity", minHeight: 142 }}>
      <DramaArtwork drama={drama} width={ROW_COVER_WIDTH} height={ROW_COVER_HEIGHT} radius={10} showsBadge={false} />
      <VStack spacing={5} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="headline" fontWeight="semibold" lineLimit={3} multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{drama.name}</Text>
        <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={2} multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{metadata || "短剧"}</Text>
        {drama.description ? <Text font="caption" foregroundStyle="tertiaryLabel" lineLimit={2} multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{drama.description}</Text> : undefined}
      </VStack>
      <Image systemName="chevron.right" font="caption" foregroundStyle="tertiaryLabel" frame={{ width: 16 }} />
    </HStack>
  </Button>
}

export function DramaRowList({ items, subtitle, onOpen }: { items: DramaItem[]; subtitle?: (drama: DramaItem) => string | undefined; onOpen: (drama: DramaItem) => void }) {
  return <VStack spacing={0} frame={{ maxWidth: "infinity" }}>{items.map((drama, index) => <VStack key={drama.id} spacing={0} frame={{ maxWidth: "infinity" }}><DramaRow drama={drama} subtitle={subtitle?.(drama)} onOpen={onOpen} />{index < items.length - 1 ? <Divider /> : undefined}</VStack>)}</VStack>
}

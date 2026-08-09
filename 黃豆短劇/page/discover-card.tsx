import { Button, HStack, Image, Text, VStack, ZStack } from "scripting"
import type { DramaItem } from "../client"
import { COVER_RADIUS } from "../design"

function payLabel(payType?: string) {
  if (!payType) return ""
  return payType === "free" ? "免费" : payType === "vip" ? "会员" : payType === "money" ? "金币" : payType
}

export function DiscoverDramaCard({ drama, onOpen }: { drama: DramaItem; onOpen: (drama: DramaItem) => void }) {
  const meta = [drama.category, drama.episodeCount ? `${drama.episodeCount} 集` : "", drama.updateLabel].filter(Boolean).join(" · ")
  const badge = payLabel(drama.payType)
  return <Button action={() => onOpen(drama)} buttonStyle="plain" contentShape="rect" frame={{ maxWidth: "infinity", alignment: "topLeading" }} accessibilityLabel={[drama.name, meta, "打开详情"].filter(Boolean).join("，")}>
    <VStack spacing={7} alignment="leading" frame={{ maxWidth: "infinity", alignment: "topLeading" }}>
      <ZStack aspectRatio={{ value: 7 / 10, contentMode: "fit" }} frame={{ maxWidth: "infinity" }} background={drama.cover ? undefined : "tertiarySystemFill"} clipShape={{ type: "rect", cornerRadius: COVER_RADIUS, style: "continuous" }}>
        {drama.cover ? <Image imageUrl={drama.cover} resizable aspectRatio={{ contentMode: "fit" }} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} /> : <Image systemName="play.rectangle" font="title2" foregroundStyle="tertiaryLabel" />}
        {badge ? <HStack frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topTrailing" }} padding={8}><Text font="caption2" fontWeight="bold" foregroundStyle="white" padding={{ horizontal: 8, vertical: 4 }} background="rgba(0,0,0,0.72)" clipShape="capsule">{badge}</Text></HStack> : undefined}
      </ZStack>
      <Text font="subheadline" fontWeight="semibold" lineLimit={2} multilineTextAlignment="leading" frame={{ maxWidth: "infinity", minHeight: 38, alignment: "topLeading" }}>{drama.name}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1} frame={{ maxWidth: "infinity", minHeight: 17, alignment: "leading" }}>{meta || "短剧"}</Text>
    </VStack>
  </Button>
}

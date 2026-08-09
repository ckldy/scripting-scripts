import { Button, HStack, Image, ProgressView, Text, VStack, ZStack, type Color } from "scripting"

export const ACCENT: Color = "systemYellow"
export const PAGE_PADDING = 18
export const PAGE_BOTTOM_PADDING = 52
export const SECTION_SPACING = 28
export const SECTION_CONTENT_SPACING = 12
export const GRID_SPACING = 14
export const COVER_RADIUS = 14
export const GRID_COVER_HEIGHT = 208
export const SHELF_CARD_WIDTH = 154
export const SHELF_COVER_HEIGHT = 274
export const ROW_COVER_WIDTH = 88
export const ROW_COVER_HEIGHT = 118

export function PageBackground() {
  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background="systemBackground" />
}

export function SectionHeading(props: { title: string; subtitle?: string; trailing?: any }) {
  return <HStack spacing={12} alignment="top" frame={{ maxWidth: "infinity", alignment: "top" }}>
    <VStack spacing={3} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text font="title3" fontWeight="bold" frame={{ maxWidth: "infinity", alignment: "leading" }}>{props.title}</Text>
      {props.subtitle ? <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={3} multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{props.subtitle}</Text> : undefined}
    </VStack>
    {props.trailing}
  </HStack>
}

export function StateCard(props: { title: string; description: string; systemImage: string; tint?: Color; actionTitle?: string; action?: () => void }) {
  return <VStack spacing={12} padding={18} frame={{ maxWidth: "infinity", alignment: "leading" }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 18, style: "continuous" }}>
    <HStack spacing={10}><Image systemName={props.systemImage} foregroundStyle={props.tint ?? ACCENT} frame={{ width: 22 }} /><Text font="headline" fontWeight="bold" frame={{ maxWidth: "infinity", alignment: "leading" }}>{props.title}</Text></HStack>
    <Text font="subheadline" foregroundStyle="secondaryLabel" multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{props.description}</Text>
    {props.action && props.actionTitle ? <Button title={props.actionTitle} action={props.action} /> : undefined}
  </VStack>
}

export function LoadingState(props: { title: string; minHeight?: number }) {
  return <VStack spacing={10} frame={{ maxWidth: "infinity", minHeight: props.minHeight ?? 280 }}><ProgressView progressViewStyle="circular" tint={ACCENT} /><Text font="subheadline" foregroundStyle="secondaryLabel">{props.title}</Text></VStack>
}

export function Pagination(props: { page: number; hasNext: boolean; loading: boolean; onPrevious: () => void; onNext: () => void }) {
  return <HStack spacing={10} padding={{ top: 8 }} frame={{ maxWidth: "infinity", minHeight: 48 }}>
    <Button title="上一页" systemImage="chevron.left" disabled={props.page <= 1 || props.loading} action={props.onPrevious} />
    <Text font="subheadline" fontWeight="medium" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity" }} multilineTextAlignment="center">{`第 ${props.page} 页`}</Text>
    <Button title="下一页" systemImage="chevron.right" tint={ACCENT} disabled={!props.hasNext || props.loading} action={props.onNext} />
  </HStack>
}

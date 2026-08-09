import { ScrollView, Text, VStack, ZStack } from "scripting"
import { PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, SECTION_SPACING, SectionHeading, StateCard } from "../design"

export function SettingsPage() {
  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}><PageBackground /><ScrollView navigationTitle="设置" navigationBarTitleDisplayMode="large"><VStack spacing={SECTION_SPACING} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 8, bottom: PAGE_BOTTOM_PADDING }}>
    <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}><SectionHeading title="关于黃豆短劇" subtitle="浏览、收藏与剧集播放" /><StateCard title="短剧浏览与播放" description="浏览分类与发现内容，搜索短剧、收藏作品并查看播放历史；选集可直接在应用内播放。" systemImage="play.rectangle.fill" /></VStack>
    <VStack spacing={5} alignment="leading" frame={{ maxWidth: "infinity" }}><Text font="headline" fontWeight="bold">版本</Text><Text font="footnote" foregroundStyle="secondaryLabel">1.1.0</Text></VStack>
  </VStack></ScrollView></ZStack>
}

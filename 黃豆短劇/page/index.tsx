import { Button, Image, Navigation, NavigationStack, Script, Tab, TabView, Toolbar, ToolbarItem, useObservable } from "scripting"
import { ACCENT } from "../design"
import { DiscoverPage } from "./discover"
import { HomePageContent } from "./home"
import { LibraryPage } from "./library"
import { SearchPage } from "./search"
import { SettingsPage } from "./settings"

export function HomePage() {
  const dismiss = Navigation.useDismiss(), selection = useObservable(0), revision = useObservable(0), settingsPresented = useObservable(false)
  const bumpLibrary = () => revision.setValue(revision.value + 1)
  const toolbar = <Toolbar><ToolbarItem placement="topBarLeading" sharedBackgroundVisibility="visible"><Button action={() => dismiss()} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" accessibilityLabel="关闭黃豆短劇"><Image systemName="xmark" font="headline" foregroundStyle="label" /></Button></ToolbarItem><ToolbarItem placement="topBarTrailing" sharedBackgroundVisibility="visible"><Button action={() => settingsPresented.setValue(true)} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" navigationDestination={{ isPresented: settingsPresented, content: <SettingsPage /> }} accessibilityLabel="设置"><Image systemName="gearshape" font="headline" foregroundStyle="label" /></Button></ToolbarItem>{Script.supportsMinimization() ? <ToolbarItem placement="topBarTrailing" sharedBackgroundVisibility="visible"><Button action={() => { if (!Script.isMinimized()) Script.minimize().catch(() => {}) }} buttonStyle="plain" frame={{ width: 44, height: 44 }} contentShape="rect" accessibilityLabel="最小化黃豆短劇"><Image systemName="arrow.down.right.and.arrow.up.left" font="headline" foregroundStyle="label" /></Button></ToolbarItem> : undefined}</Toolbar>
  return <NavigationStack><TabView selection={selection} tint={ACCENT} toolbar={toolbar} tabViewStyle="sidebarAdaptable" tabBarMinimizeBehavior="onScrollDown"><Tab title="首页" systemImage="house" value={0}><HomePageContent onLibraryChanged={bumpLibrary} /></Tab><Tab title="发现" systemImage="square.grid.2x2" value={1}><DiscoverPage onLibraryChanged={bumpLibrary} /></Tab><Tab title="资料库" systemImage="play.square.stack" value={2}><LibraryPage revision={revision.value} onLibraryChanged={bumpLibrary} /></Tab><Tab title="搜索" systemImage="magnifyingglass" role="search" value={3}><SearchPage onLibraryChanged={bumpLibrary} /></Tab></TabView></NavigationStack>
}

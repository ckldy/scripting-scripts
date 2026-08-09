import type { DramaItem } from "./client"

const FAVOURITES_KEY = "huangdou_favourites_v1"
const HISTORY_KEY = "huangdou_history_v1"
export type DramaHistoryRecord = { drama: DramaItem; seq: number; episodeName: string; playedAt: number }

export function loadFavourites(): DramaItem[] { return safeArray<DramaItem>(Storage.get(FAVOURITES_KEY)) }
export function isFavourite(id: string): boolean { return loadFavourites().some(item => item.id === id) }
export function toggleFavourite(drama: DramaItem): boolean { const list = loadFavourites(); const exists = list.some(item => item.id === drama.id); Storage.set(FAVOURITES_KEY, exists ? list.filter(item => item.id !== drama.id) : [drama, ...list.filter(item => item.id !== drama.id)]); return !exists }
export function loadHistory(): DramaHistoryRecord[] { return safeArray<DramaHistoryRecord>(Storage.get(HISTORY_KEY)).sort((a, b) => b.playedAt - a.playedAt) }
export function recordPlayback(drama: DramaItem, seq: number, episodeName: string): void { const list = loadHistory().filter(item => item.drama.id !== drama.id); Storage.set(HISTORY_KEY, [{ drama, seq, episodeName, playedAt: Date.now() }, ...list].slice(0, 100)) }
export function clearHistory(): void { Storage.remove(HISTORY_KEY) }
export function clearFavourites(): void { Storage.remove(FAVOURITES_KEY) }
function safeArray<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : [] }

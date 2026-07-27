import { LayoutDashboard, Server, FileKey2, ScrollText, Settings, type LucideIcon } from 'lucide-react';
import type { Page } from '../lib/router';

/**
 * The glyph for a route.
 *
 * Each navigation surface used to keep its own map — the top strip at 15px, the
 * palette at 16px — so adding a page meant remembering every copy, and the
 * phone tab bar would have made a third. Size is the only thing that varies, so
 * size is the only thing a caller passes.
 */

const ICONS: Record<Page, LucideIcon> = {
  torrents: LayoutDashboard,
  mules: Server,
  configs: FileKey2,
  events: ScrollText,
  settings: Settings,
};

export function PageIcon({ page, size = 16 }: Readonly<{ page: Page; size?: number }>) {
  const Icon = ICONS[page];
  return <Icon size={size} />;
}

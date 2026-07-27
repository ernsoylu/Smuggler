/**
 * Platform-dependent key labels.
 *
 * useKeyboardShortcuts has always accepted `e.ctrlKey || e.metaKey`, so ⌘K
 * genuinely worked on a Mac — the chip in the header just said "Ctrl K"
 * everywhere, advertising the wrong key on the one platform where the other
 * one is the convention.
 *
 * Kept DOM-free and parameterised so the detection is testable without
 * stubbing a global: the caller passes what it observes.
 */

/** True for macOS/iPadOS, where the command key is the shortcut modifier. */
export function isApplePlatform(platform: string | undefined): boolean {
  if (!platform) return false;
  // "MacIntel" covers Intel and Apple-silicon Macs; iPads report "iPad" or,
  // in desktop mode, "MacIntel" with a touch-capable pointer.
  return /^(mac|iphone|ipad|ipod)/i.test(platform);
}

/** The modifier's display label: "⌘" on Apple platforms, "Ctrl" elsewhere. */
export function modKeyLabel(platform: string | undefined): string {
  return isApplePlatform(platform) ? '⌘' : 'Ctrl';
}

import { useEffect, useRef } from 'react';

/**
 * Makes a modal usable by keyboard and announced correctly by screen readers.
 *
 * The modals had none of this: no role, no focus management, and no way out
 * except clicking the backdrop — a keyboard user could tab straight out of an
 * open dialog into the page behind it, and Escape did nothing.
 *
 * Returns a ref to spread onto the dialog element along with `modalA11yProps`.
 *
 * @param onClose  called on Escape; pass undefined to disable dismissal (e.g.
 *                 while an irreversible action is in flight)
 * @param active   whether the dialog is currently open. Some modals stay
 *                 mounted and return null when closed, so the trap has to
 *                 engage and release with this rather than on mount.
 */
export function useModalA11y(onClose?: () => void, active: boolean = true) {
  const ref = useRef<HTMLDivElement>(null);
  // Kept in a ref so changing the handler doesn't re-run the trap effect and
  // steal focus back to the top of the dialog mid-interaction.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = (): HTMLElement[] =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), ' +
          'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(el => el.offsetParent !== null || el === document.activeElement);

    // Focus the first control rather than the dialog container, so a keyboard
    // user starts where they can actually type.
    const initial = focusable()[0] ?? node;
    initial.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (onCloseRef.current) {
          e.stopPropagation();
          onCloseRef.current();
        }
        return;
      }
      if (e.key !== 'Tab') return;

      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      // Wrap at both ends so focus stays inside the dialog.
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener('keydown', onKeyDown);
    return () => {
      node.removeEventListener('keydown', onKeyDown);
      // Return focus to whatever opened the modal.
      previouslyFocused?.focus?.();
    };
  }, [active]);

  return ref;
}

/** ARIA attributes every modal dialog needs. Spread alongside the ref. */
export const modalA11yProps = {
  role: 'dialog',
  'aria-modal': true,
  tabIndex: -1,
} as const;

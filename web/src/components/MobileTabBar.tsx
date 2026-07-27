import { Box, Text, UnstyledButton } from '@mantine/core';
import { PAGES, PAGE_LABELS, type Page } from '../lib/router';
import { PageIcon } from './PageIcon';

/**
 * Bottom tab bar — the primary navigation below `sm`.
 *
 * The top strip fits five labelled tabs, a logo and four controls on a laptop
 * and nothing like it on a 380px phone, where the labels dropped and the tabs
 * became five unlabelled 30px icons wedged against the brand mark. Moving them
 * to the bottom edge gives each tab a seventh of the width, a readable label
 * and a thumb-reachable position, which is what every phone app does and what
 * the top of a tall screen cannot offer.
 *
 * Rendered as anchors, not buttons: the routes are real URLs, so long-press,
 * middle-click and "copy link" keep working. The shell hides this from `sm` up,
 * so only one primary nav is ever in the accessibility tree.
 */

export function MobileTabBar({ page }: Readonly<{ page: Page }>) {
  return (
    <Box
      component="nav"
      aria-label="Primary"
      hiddenFrom="sm"
      style={{
        flexShrink: 0,
        display: 'flex',
        borderTop: '1px solid var(--mantine-color-default-border)',
        background: 'var(--mantine-color-body)',
        // Clears the iPhone home indicator, and collapses to 0 everywhere else.
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {PAGES.map(key => {
        const current = page === key;
        return (
          <UnstyledButton
            key={key}
            component="a"
            href={`#/${key}`}
            aria-label={PAGE_LABELS[key]}
            aria-current={current ? 'page' : undefined}
            c={current ? 'var(--smg-nav-active)' : 'dimmed'}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              // Comfortably past the 44px touch-target floor.
              minHeight: 52,
              paddingBlock: 6,
              // The active tab is marked twice over — colour alone would leave
              // a colour-blind user with five identical icons.
              borderTop: `2px solid ${current ? 'var(--smg-nav-active)' : 'transparent'}`,
              marginTop: -1,
            }}
          >
            <PageIcon page={key} size={20} />
            <Text size="10px" fw={current ? 700 : 500} lh={1} style={{ letterSpacing: 0.2 }}>
              {PAGE_LABELS[key]}
            </Text>
          </UnstyledButton>
        );
      })}
    </Box>
  );
}

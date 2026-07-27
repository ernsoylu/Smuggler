import { createTheme, type CSSVariablesResolver, type MantineColorsTuple } from '@mantine/core';

/**
 * Smuggler Mantine theme.
 *
 * `smuggler` is the brand orange (the amber→orange gradient of the logo reduced
 * to a ramp); `dark` overrides Mantine's blue-tinted dark palette with the
 * neutral near-black the app has always used (Tailwind neutral-950 era).
 */

const smuggler: MantineColorsTuple = [
  '#fff7ed',
  '#ffedd5',
  '#fed7aa',
  '#fdba74',
  '#fb923c',
  '#f97316',
  '#ea580c',
  '#c2410c',
  '#9a3412',
  '#7c2d12',
];

const dark: MantineColorsTuple = [
  '#e7e7e7',
  '#b8b8b8',
  '#8a8a8a',
  '#5f5f5f',
  '#3a3a3a',
  '#2a2a2a',
  '#171717',
  '#0f0f0f',
  '#0a0a0a',
  '#050505',
];

export const theme = createTheme({
  primaryColor: 'smuggler',
  primaryShade: { light: 6, dark: 5 },
  colors: { smuggler, dark },
  /*
   * Filled buttons are the most repeated element in the app, and the brand
   * orange is too light to carry Mantine's default white label: white on
   * smuggler-5 (#f97316) is 2.80:1 and on smuggler-6 (#ea580c) 3.56:1 — both
   * under WCAG AA, in both colour schemes.
   *
   * autoContrast swaps the label to theme.black once the background's relative
   * luminance passes `luminanceThreshold`, which keeps the brand orange exactly
   * as-is and moves only the text. The default threshold of 0.3 is too high to
   * catch us: smuggler-5 sits at 0.325 (fixed) but smuggler-6 at 0.245 (still
   * white, still failing). 0.2 covers both — 7.49:1 dark, 5.90:1 light.
   */
  autoContrast: true,
  luminanceThreshold: 0.2,
  defaultRadius: 'md',
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  headings: { fontWeight: '700' },
});

/**
 * Overrides for Mantine's own CSS variables.
 *
 * Mantine's light-scheme dimmed is gray-6 (#868e96), which is 3.32:1 on the
 * white body — under WCAG AA for the page subtitles, table headers and setup
 * copy that all lean on `c="dimmed"`. gray-7 (8.18:1) reads as full-strength
 * body text and loses the distinction entirely, so this sits between them at
 * 4.69:1: still visibly secondary, no longer inaccessible. The dark scheme
 * already passes (dark-2 #8a8a8a on #0f0f0f is 5.55:1) and is left alone.
 *
 * This has to go through cssVariablesResolver rather than a rule in index.css:
 * Mantine declares the variable at `:root[data-mantine-color-scheme='light']`
 * (and the `:host` equivalent), which outspecifies a bare attribute selector,
 * so a plain override silently loses the cascade and leaves the app at 3.32:1.
 */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    '--mantine-color-dimmed': '#6c757d',

    /*
     * `light` variants pair `-light-color` text with a `-light` tint. Mantine's
     * defaults do not clear AA on two of the hues this app leans on: teal is
     * 4.33:1 and yellow only 2.69:1, which is what every "Running" pill, VPN
     * type tag and paused badge was rendering at. Both stay well clear on the
     * white body too (6.99:1 and 6.33:1), so nothing else regresses.
     */
    '--mantine-color-teal-light-color': '#066649',    /* 6.04:1 on teal-light  */
    '--mantine-color-yellow-light-color': '#8a5300',  /* 5.67:1 on yellow-light */
  },
  dark: {},
});

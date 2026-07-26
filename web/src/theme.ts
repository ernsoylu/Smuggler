import { createTheme, type MantineColorsTuple } from '@mantine/core';

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
  defaultRadius: 'md',
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  headings: { fontWeight: '700' },
});

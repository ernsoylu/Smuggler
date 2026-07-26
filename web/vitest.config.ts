import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/*
 * This file — not a `test` key in vite.config.ts — is what Vitest resolves, so
 * all test configuration belongs here.
 *
 * The React plugin is declared explicitly: a vitest.config replaces vite.config
 * outright rather than merging with it, and without the JSX transform every
 * .tsx test fails to parse.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    // Split by extension rather than running everything under jsdom: the pure
    // logic in lib/ and api/ has no DOM to need, and keeping it in node means a
    // failure there can never be a jsdom artefact.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.{test,spec}.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          include: ['src/**/*.{test,spec}.tsx'],
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // lcov feeds SonarQube (see sonar-project.properties); text is for local runs.
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        // Test-only helpers and fixtures, not product code.
        'src/test/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/**/*.d.ts',
      ],
    },
  },
})

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Auto-cleanup only registers itself when the runner exposes globals, and this
// suite imports its test functions explicitly. Without this, mounted trees leak
// between cases and queries start matching the previous test's DOM.
afterEach(cleanup);

// Mantine reads both of these during render and jsdom implements neither.
// Without the stubs every component test throws before its first assertion.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

// Mantine's ScrollArea and Popover measure elements jsdom never lays out.
window.HTMLElement.prototype.scrollIntoView = vi.fn();

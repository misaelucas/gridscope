import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
// Each mode test opts in explicitly, independent of the developer's shell setting.
beforeEach(() => { vi.stubEnv('VITE_DATA_MODE', 'api'); });
class ResizeObserverMock {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, contentRect: { width: 800, height: 340 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
// Real chart geometry, deterministic in jsdom; no Recharts component mocks.
Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverMock, configurable: true });
Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
  value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 340, width: 800, height: 340, toJSON() {} }),
});
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { get: () => 800 });
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { get: () => 340 });

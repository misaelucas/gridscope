import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import App from '../App';
import { response } from './fixtures';

function deferredFetch() {
  const requests: { url: string; signal: AbortSignal; resolve: (response: Response) => void; reject: (error: Error) => void }[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
    requests.push({ url, signal: options.signal!, resolve, reject });
  })));
  return {
    requests,
    async finish(offset = 0, empty = false) {
      await act(async () => { for (const request of requests.slice(offset, offset + 4)) request.resolve(response(request.url, empty)); });
    },
  };
}
it('renders populated cards, a real chart, report details, run zero and methodology', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url)));
  render(<App />);
  expect(await screen.findByRole('region', { name: 'DK1' })).toHaveTextContent('0.0 g CO₂/kWh');
  expect(screen.getByRole('region', { name: 'DK2' })).toHaveTextContent('Latest observation:');
  expect(screen.getByRole('table')).toHaveTextContent('running0');
  expect(screen.getByText(/not consumption-weighted/)).toBeVisible();
  await waitFor(() => expect(document.querySelectorAll('.recharts-line')).toHaveLength(2));
});
it('edits clear the previous report immediately; submit uses the selected date', async () => {
  const fetches = deferredFetch(); render(<App />); await fetches.finish();
  fireEvent.change(screen.getByLabelText('Danish local day'), { target: { value: '2026-10-25' } });
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'DK1' })).not.toBeInTheDocument();
  expect(fetches.requests).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: 'Load report' }));
  expect(screen.getByRole('status')).toHaveTextContent('Loading report for 2026-10-25');
  expect(fetches.requests[4].url).toContain('day=2026-10-25');
  await fetches.finish(4);
  expect(await screen.findByRole('table')).toBeVisible();
});
it('latest load wins even if old fetches ignore abort, including repeated same-day loads', async () => {
  const fetches = deferredFetch(); render(<App />);
  fireEvent.change(screen.getByLabelText('Danish local day'), { target: { value: '2026-10-25' } });
  fireEvent.click(screen.getByRole('button', { name: 'Load report' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load report' }));
  expect(fetches.requests.slice(0, 8).every(request => request.signal.aborted)).toBe(true);
  await fetches.finish(8, true); await fetches.finish(4); await fetches.finish(0);
  expect(screen.getAllByText('No data g CO₂/kWh')).toHaveLength(2);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByText('No observations for this day.')).toBeVisible();
});
it.each(['AbortError', 'Error'])('ignores superseded %s without clearing a new report', async name => {
  const fetches = deferredFetch(); render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Load report' }));
  await fetches.finish(4);
  await act(async () => fetches.requests[0].reject(Object.assign(new Error('obsolete'), { name })));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('table')).toBeVisible();
});
it.each([0, 1, 2, 3])('failure in endpoint %i clears all data and allows recovery', async endpoint => {
  const fetches = deferredFetch(); render(<App />); await fetches.finish();
  fireEvent.click(screen.getByRole('button', { name: 'Load report' }));
  await act(async () => fetches.requests[4 + endpoint].resolve({ ok: false, status: 503 } as Response));
  expect(screen.getByRole('alert')).toHaveTextContent('503');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'DK1' })).not.toBeInTheDocument();
  expect(document.querySelector('.recharts-wrapper')).not.toBeInTheDocument();
  await fetches.finish(4);
  fireEvent.click(screen.getByRole('button', { name: 'Load report' }));
  await fetches.finish(8);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('table')).toBeVisible();
});
it.each(['network', 'JSON'])('handles %s failures', async failure => {
  const fetches = deferredFetch(); render(<App />);
  await act(async () => {
    if (failure === 'network') fetches.requests[0].reject(new Error('Network unavailable'));
    else fetches.requests[0].resolve({ ok: true, json: async () => { throw new Error('Invalid JSON'); } } as unknown as Response);
  });
  expect(screen.getByRole('alert')).toHaveTextContent(failure === 'network' ? 'Network unavailable' : 'Invalid JSON');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
it('empty data has null summaries rather than zero, and no chart or runs', async () => {
  const fetches = deferredFetch(); render(<App />); await fetches.finish(0, true);
  expect(within(screen.getByRole('region', { name: 'DK1' })).getByText('No data g CO₂/kWh')).toBeVisible();
  expect(screen.getByText('No ingestion runs yet.')).toBeVisible();
  expect(document.querySelector('.recharts-wrapper')).not.toBeInTheDocument();
});
it('aborts pending requests on unmount', async () => {
  const fetches = deferredFetch(); const view = render(<App />); view.unmount();
  expect(fetches.requests.every(request => request.signal.aborted)).toBe(true);
  await fetches.finish();
});

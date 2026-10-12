import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { CarbonChart, CarbonTooltip } from '../components/CarbonChart';

const start = Date.parse('2026-10-25T00:30:00Z');
const points = Array.from({ length: 13 }, (_, i) => ({ instant: start + i * 300_000, DK1: i === 6 ? null : 0, DK2: i === 6 ? null : 12.345 }));
it('custom tooltip distinguishes zero, exact numeric values and null with offset', () => {
  const view = render(<CarbonTooltip active point={points[0]} />);
  expect(screen.getByRole('tooltip')).toHaveTextContent('2026-10-25 02:30:00 UTC+02:00');
  expect(screen.getByRole('tooltip')).toHaveTextContent('DK10 g CO₂/kWh');
  expect(screen.getByRole('tooltip')).toHaveTextContent('DK212.345 g CO₂/kWh');
  view.rerender(<CarbonTooltip active point={points[6]} />);
  expect(screen.getAllByText('No data g CO₂/kWh')).toHaveLength(2);
});
it('real Recharts hover displays both series and preserves line breaks', async () => {
  const view = render(<CarbonChart points={points} />);
  const wrapper = view.container.querySelector('.recharts-wrapper')!;
  fireEvent.mouseMove(wrapper, { clientX: 60, clientY: 100 });
  expect(await screen.findByRole('tooltip')).toHaveTextContent('UTC+02:00');
  expect(screen.getByRole('tooltip')).toHaveTextContent('g CO₂/kWh');
  const paths = [...view.container.querySelectorAll('.recharts-line-curve')];
  expect(paths).toHaveLength(2);
  for (const path of paths) expect(path.getAttribute('d')?.match(/M/g)).toHaveLength(2);
  fireEvent.mouseMove(wrapper, { clientX: 775, clientY: 100 });
  await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('2026-10-25 02:30:00 UTC+01:00'));
});
it('real Recharts touch movement inspects a missing slot without turning it into zero', async () => {
  const view = render(<CarbonChart points={points} />);
  const wrapper = view.container.querySelector('.recharts-wrapper')!;
  fireEvent.touchMove(wrapper, { touches: [{ clientX: 414, clientY: 100 }] });
  expect(await screen.findByRole('tooltip')).toHaveTextContent('2026-10-25 02:00:00 UTC+01:00');
  expect(screen.getAllByText('No data g CO₂/kWh')).toHaveLength(2);
});

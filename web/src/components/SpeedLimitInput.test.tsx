import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/render';
import { SpeedLimitInput } from './SpeedLimitInput';

const field = () => screen.getByRole('textbox', { name: /max download/i });

describe('SpeedLimitInput', () => {
  it('shows a stored byte value in the largest clean unit', () => {
    renderWithProviders(
      <SpeedLimitInput label="Max download" value={5_242_880} onChange={vi.fn()} />,
    );
    // 5242880 B/s is 5 MB/s — the user should never see the byte count.
    expect(field()).toHaveValue('5');
    expect(screen.getByRole('combobox', { name: /max download unit/i })).toHaveValue('MB/s');
  });

  it('keeps an unevenly-dividing value in bytes rather than showing a fraction', () => {
    renderWithProviders(
      <SpeedLimitInput label="Max download" value={1000} onChange={vi.fn()} />,
    );
    expect(field()).toHaveValue('1000');
    expect(screen.getByRole('combobox', { name: /max download unit/i })).toHaveValue('B/s');
  });

  it('reports the typed number converted to bytes per second', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <SpeedLimitInput label="Max download" value={1_048_576} onChange={onChange} />,
    );

    await userEvent.clear(field());
    await userEvent.type(field(), '3');

    // Unit is MB/s (from 1048576), so 3 means 3 MB/s, not 3 B/s.
    expect(onChange).toHaveBeenLastCalledWith(3 * 1024 * 1024);
  });

  it('says so when the limit means unlimited', () => {
    renderWithProviders(<SpeedLimitInput label="Max download" value={0} onChange={vi.fn()} />);
    expect(screen.getByText(/unlimited/i)).toBeInTheDocument();
  });

  it('does not claim unlimited once a limit is set', () => {
    renderWithProviders(<SpeedLimitInput label="Max download" value={1024} onChange={vi.fn()} />);
    expect(screen.queryByText(/unlimited/i)).not.toBeInTheDocument();
  });

  it('labels the field for assistive tech even when the caller draws its own heading', () => {
    renderWithProviders(
      <SpeedLimitInput label="Max download" value={0} onChange={vi.fn()} visibleLabel={false} />,
    );
    // No visible label, but the control is still named.
    expect(screen.getByRole('textbox', { name: /max download/i })).toBeInTheDocument();
  });
});

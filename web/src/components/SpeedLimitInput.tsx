import { useState } from 'react';
import { Group, NumberInput, Select, Text } from '@mantine/core';
import {
  SPEED_UNITS, isSpeedUnit, isUnlimited, splitSpeed, toBytesPerSecond, type SpeedUnit,
} from '../lib/speed';

interface Props {
  /** Always the accessible name; rendered visibly unless visibleLabel is false. */
  label: string;
  /** Current limit in bytes per second; 0 means unlimited. */
  value: number;
  onChange: (bytesPerSecond: number) => void;
  /** False where the caller already renders its own heading for the field. */
  visibleLabel?: boolean;
  description?: string;
  size?: 'xs' | 'sm';
  id?: string;
}

/**
 * Rate limit entered in a unit a human uses.
 *
 * Both limit fields asked for raw bytes per second, so capping a download at
 * 5 MB/s meant typing 5242880. The stored value is still B/s — only the entry
 * changes.
 *
 * The unit is local state seeded from the stored value rather than derived on
 * every render: re-deriving would yank the user's chosen unit away mid-edit as
 * soon as the number stopped dividing evenly.
 */
export function SpeedLimitInput({
  label, value, onChange, visibleLabel = true, description, size = 'sm', id,
}: Readonly<Props>) {
  const [unit, setUnit] = useState<SpeedUnit>(() => splitSpeed(value).unit);
  const shown = value === 0 ? 0 : value / unitFactor(unit);

  return (
    <div>
      <Group gap="xs" align="flex-end" wrap="nowrap">
        <NumberInput
          id={id}
          label={visibleLabel ? label : undefined}
          aria-label={visibleLabel ? undefined : label}
          description={description}
          size={size}
          min={0}
          step={1}
          decimalScale={3}
          flex={1}
          value={shown}
          onChange={v => onChange(toBytesPerSecond(Number(v) || 0, unit))}
        />
        <Select
          aria-label={`${label} unit`}
          size={size}
          w={92}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
          data={SPEED_UNITS as unknown as string[]}
          value={unit}
          // Changing the unit reinterprets the number the user is looking at,
          // rather than silently keeping the byte value and relabelling it.
          onChange={u => {
            if (!u || !isSpeedUnit(u)) return;
            setUnit(u);
            onChange(toBytesPerSecond(shown, u));
          }}
        />
      </Group>
      {isUnlimited(value) && (
        <Text size="xs" c="dimmed" mt={4}>Unlimited.</Text>
      )}
    </div>
  );
}

function unitFactor(unit: SpeedUnit): number {
  return toBytesPerSecond(1, unit);
}

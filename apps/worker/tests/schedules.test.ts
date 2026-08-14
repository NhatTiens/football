import { describe, expect, it } from 'vitest';
import cron from 'node-cron';

import { buildWorkerScheduleConfiguration } from '../src/schedules.js';

describe('worker production schedules', () => {
  it('runs current discovery and the fresh scientific live cycle in production', () => {
    const config = buildWorkerScheduleConfiguration({});
    const commands = config.schedules.map(([, command]) => command);

    expect(commands).toContain('scientific-current-refresh');
    expect(commands).toContain('scientific-live-cycle');
    expect(commands).not.toContain('paper-bet-operations-cycle');
    expect(config.schedules.every(([expression]) => cron.validate(expression))).toBe(true);
  });

  it('leaves provider collection to the dedicated development autopilot', () => {
    const config = buildWorkerScheduleConfiguration({
      DEV_SCIENCE_OWNS_PROVIDER_SYNC: 'true',
    });
    const commands = config.schedules.map(([, command]) => command);

    expect(commands).not.toContain('scientific-current-refresh');
    expect(commands).not.toContain('scientific-live-cycle');
  });

  it('allows the quota-heavy current refresh to be explicitly disabled', () => {
    const config = buildWorkerScheduleConfiguration({
      SCIENTIFIC_CURRENT_REFRESH_ENABLED: 'false',
    });
    const commands = config.schedules.map(([, command]) => command);

    expect(commands).not.toContain('scientific-current-refresh');
    expect(commands).toContain('scientific-live-cycle');
  });
});

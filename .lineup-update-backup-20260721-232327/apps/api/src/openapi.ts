export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Football Value AI API',
    version: '1.1.0',
    description:
      'REST API for fixtures, odds-driven value recommendations, point-in-time backtests and synchronization.',
  },
  servers: [{ url: '/api' }],
  paths: {
    '/health': {
      get: { summary: 'Health check', responses: { '200': { description: 'Healthy' } } },
    },
    '/stats': {
      get: {
        summary: 'Dashboard statistics',
        responses: { '200': { description: 'Statistics' } },
      },
    },
    '/leagues': {
      get: { summary: 'List configured leagues', responses: { '200': { description: 'Leagues' } } },
    },
    '/fixtures': {
      get: { summary: 'List fixtures', responses: { '200': { description: 'Fixtures' } } },
    },
    '/fixtures/{id}': {
      get: {
        summary: 'Fixture detail with latest odds and recommendations',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Fixture' }, '404': { description: 'Not found' } },
      },
    },
    '/recommendations': {
      get: {
        summary: 'List recommendations',
        responses: { '200': { description: 'Recommendations' } },
      },
    },
    '/backtests': {
      get: {
        summary: 'List point-in-time backtest runs',
        responses: { '200': { description: 'Backtest runs' } },
      },
    },
    '/backtests/latest': {
      get: {
        summary: 'Latest successful backtest',
        responses: { '200': { description: 'Latest backtest or null' } },
      },
    },
    '/backtests/{id}': {
      get: {
        summary: 'Backtest detail, bet log, market summary and equity curve',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Backtest detail' }, '404': { description: 'Not found' } },
      },
    },
    '/admin/backtests/run': {
      post: {
        summary: 'Run a point-in-time backtest',
        parameters: [
          {
            name: 'x-admin-token',
            in: 'header',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  from: { type: 'string', format: 'date-time' },
                  to: { type: 'string', format: 'date-time' },
                  leagueId: { type: 'integer' },
                  fixtureLimit: { type: 'integer', minimum: 1, maximum: 5000 },
                  stakeUnits: { type: 'number', minimum: 0.01 },
                  rules: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Backtest completed' },
          '401': { description: 'Invalid admin token' },
        },
      },
    },
  },
};

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Football Value AI API',
    version: '1.2.0',
    description:
      'REST API for fixtures, confirmed lineups, odds-driven value recommendations, point-in-time backtests and synchronization.',
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
    '/auth/me': {
      get: {
        summary: 'Current authenticated user and session state',
        responses: { '200': { description: 'Auth session summary' } },
      },
    },
    '/auth/register': {
      post: {
        summary: 'Register a USER account and create an HttpOnly session',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Registered and signed in' },
          '409': { description: 'Email already exists' },
        },
      },
    },
    '/auth/login': {
      post: {
        summary: 'Sign in and issue an HttpOnly session cookie',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Signed in' },
          '401': { description: 'Invalid credentials' },
          '423': { description: 'Temporarily locked after failed logins' },
        },
      },
    },
    '/auth/logout': {
      post: {
        summary: 'Revoke the current session cookie',
        responses: { '200': { description: 'Signed out' } },
      },
    },
    '/personal/prediction-chat': {
      post: {
        summary: 'Read-only PIT prediction assistant with atomic daily quota enforcement',
        responses: {
          '200': { description: 'Prediction answer based only on already-synchronized data' },
          '401': { description: 'Authentication required' },
          '403': { description: 'Plan does not allow the requested intent' },
          '429': { description: 'Daily chatbot quota exhausted' },
        },
      },
    },
    '/scientific/bets': {
      get: {
        summary:
          'Canonical fixture-paginated paper history or append-only multi-horizon audit view',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 20 } },
          { name: 'view', in: 'query', schema: { type: 'string', enum: ['summary', 'audit'] } },
        ],
        responses: { '200': { description: 'History grouped and paginated by fixture' } },
      },
    },
    '/billing/plans': {
      get: {
        summary: 'Server-owned plans with fail-closed production purchasability',
        responses: { '200': { description: 'Billing plans' } },
      },
    },
    '/billing/orders': {
      post: {
        summary: 'Server-calculate pricing and create or reuse the single active payment order',
        responses: {
          '200': { description: 'Existing active order reused' },
          '201': { description: 'Payment order created' },
          '401': { description: 'Authentication required' },
          '503': { description: 'Production price or payment configuration not confirmed' },
        },
      },
    },
    '/pricing': {
      get: {
        summary: 'Server-owned plan catalog with automatic promotions and trial terms',
        responses: { '200': { description: 'Current pricing catalog' } },
      },
    },
    '/pricing/calculate': {
      post: {
        summary: 'Calculate a personalized server-side price quote',
        responses: {
          '200': { description: 'Price quote and eligibility details' },
          '401': { description: 'Authentication required' },
        },
      },
    },
    '/pricing/validate-coupon': {
      post: {
        summary: 'Validate coupon eligibility for the authenticated user and plan',
        responses: { '200': { description: 'Coupon validation and quote' } },
      },
    },
    '/admin/promotions': {
      get: {
        summary: 'ADMIN promotion dashboard and statistics',
        responses: {
          '200': { description: 'Promotion dashboard' },
          '403': { description: 'Admin role required' },
        },
      },
      post: {
        summary: 'Create a promotion as ADMIN',
        responses: {
          '201': { description: 'Promotion created' },
          '403': { description: 'Admin role required' },
        },
      },
    },
    '/admin/promotions/{id}': {
      patch: {
        summary: 'Update a promotion and write an admin audit log',
        responses: { '200': { description: 'Promotion updated' } },
      },
      delete: {
        summary: 'Soft-delete a promotion while preserving order and usage history',
        responses: { '200': { description: 'Promotion disabled and soft-deleted' } },
      },
    },
    '/account/usage': {
      get: {
        summary: 'Authenticated daily quota usage',
        responses: {
          '200': { description: 'Usage by feature' },
          '401': { description: 'Authentication required' },
        },
      },
    },
    '/account/subscription': {
      get: {
        summary: 'Authenticated entitlement and append-only subscription history',
        responses: {
          '200': { description: 'Subscription state' },
          '401': { description: 'Authentication required' },
        },
      },
    },
    '/auth/admin/users': {
      get: {
        summary: 'List users for ADMIN role management',
        responses: {
          '200': { description: 'User list' },
          '401': { description: 'Authentication required' },
          '403': { description: 'Admin role required' },
        },
      },
    },
    '/auth/admin/users/{id}/role': {
      patch: {
        summary: 'Update a user role as ADMIN',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['role'],
                properties: {
                  role: { type: 'string', enum: ['USER', 'ANALYST', 'ADMIN'] },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Updated user role' },
          '401': { description: 'Authentication required' },
          '403': { description: 'Admin role required' },
        },
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
        summary: 'Fixture detail with latest odds, lineups, lineup impact and recommendations',
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
        responses: {
          '200': { description: 'Backtest detail' },
          '404': { description: 'Not found' },
        },
      },
    },
    '/admin/sync/lineups': {
      post: {
        summary: 'Synchronize fixture lineups or explicitly import historical lineups',
        parameters: [
          {
            name: 'x-admin-token',
            in: 'header',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  fixtureIds: { type: 'array', items: { type: 'integer' } },
                  includeHistory: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Lineup sync summary' },
          '401': { description: 'Invalid admin token' },
        },
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

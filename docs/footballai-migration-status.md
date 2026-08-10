# FootballAI Migration Status

Checked: 2026-08-10

Verify command:
`npm.cmd run db:generate && npm.cmd run typecheck && npm.cmd test && npm.cmd run build && npm.cmd run lint`

## Done

| Feature | FootballAI old | Football new | Status |
|---|---|---|---|
| Login/register/logout | PHP auth flow | TS/Express auth routes | Done |
| Argon2id password hashing | PHP password storage | `@node-rs/argon2` | Done |
| HttpOnly session cookie | Device/session flow | Cookie + hashed session token | Done |
| RBAC | User/Admin-style access | USER/ANALYST/ADMIN | Done |
| Chatbot auth gate | Protected chat flow | Session-required chatbot | Done |
| Admin CLI bootstrap | VPS admin creation | `create-admin` CLI | Done |

## Partial

| Feature | FootballAI old | Football new | Status |
|---|---|---|---|
| Email verify / reset password | Full email auth flow | Schema/config placeholders only | Partial |
| Device session management | Device/session tables | Session table only | Partial |
| Account sharing protection | Legacy anti-sharing logic | Not yet ported | Missing |
| Free/Pro pricing | PHP billing UX | Not yet ported | Missing |

## Missing

| Feature | FootballAI old | Football new | Status |
|---|---|---|---|
| Pricing / checkout / QR | PHP checkout + VietQR | Not yet ported | Missing |
| SePay webhook | Payment webhook flow | Not yet ported | Missing |
| Admin payment management | Payment admin UX | Not yet ported | Missing |
| Mail delivery | Gmail SMTP flow | Placeholder env only | Missing |
| Legacy data migration | Users/payments/history import | Not started | Missing |

## Rotation Required

- Gmail SMTP App Password
- SePay API / webhook credential
- payment webhook secret
- API tokens in public `.env`
- admin token in public `.env`


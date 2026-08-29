# Lifewood Book Portal Server

This is the complete production web server for the customer book-project intake portal. It hosts the customer portal, administrator center, and internal HTTP endpoints in one process. It owns accounts, sessions, project drafts, submitted registrations, configurable form options, uploaded files, validation, and submission records.

It is not a mock service. It supports an administrator-operated final-delivery shortcut, but it does not implement the detailed production or review workflow.

## Authentication

- The first visit from the server's loopback interface creates the platform owner account; no default account or password is shipped. For a headless Linux host, use an SSH local port forward for initial setup.
- Accounts are stored in SQLite and passwords use ASP.NET Core `PasswordHasher<TUser>`.
- Authentication uses an HttpOnly, SameSite=Strict cookie. Persistent sessions are created only when the user selects “keep me signed in”.
- Unsafe `/api` requests require an antiforgery token in `X-CSRF-TOKEN`.
- Sign-in and first-account creation are rate-limited per IP. Five failed password attempts lock the account for 15 minutes.
- Data-protection keys persist under `data/data-protection-keys`. Windows protects them with machine-scoped DPAPI, so a cross-machine restore must discard that key directory before startup and will invalidate existing sessions; account passwords and business data are unaffected. Linux relies on data-directory permissions and restores the keys with the backup.
- Deploy the service behind HTTPS. The bootstrap endpoint rejects non-loopback clients even before the first account exists; complete setup locally before handing the public address to customers.
- When TLS terminates at a reverse proxy, list only that proxy's IP addresses under `Network:TrustedProxies`; forwarded scheme and client IP headers from any other source are ignored.
- Legacy projects and upload folders are copied to the first real owner during first-account creation. The legacy owner folders remain untouched as a recoverable source copy.

## Scope

- Customer-owned draft creation, editing, and version-checked deletion
- Real file upload, download, and recoverable deletion; interrupted cleanup is reconciled on restart
- Server-managed form options and voices
- Validation and idempotent submission
- Immutable submission-time snapshots of the selected bilingual form options, voices, and file categories; later administrator edits do not rewrite historical meaning
- Submitted records are read-only to customers
- Chinese and English response data selected through `Accept-Language`

## Submission snapshots

When a draft is submitted, the same database update stores a schema-versioned JSON snapshot containing only the configuration records referenced by that project. The snapshot preserves both `zh-CN` and `en-US` labels and descriptions, including records that may later be renamed or disabled.

- Customers can read their own submitted snapshot at `GET /api/projects/{id}/submission-snapshot`.
- Administrators with project-management permission can read it at `GET /api/admin/projects/{id}/submission-snapshot`.
- Projects submitted before the snapshot migration return `404` because their historical labels cannot be reconstructed reliably.

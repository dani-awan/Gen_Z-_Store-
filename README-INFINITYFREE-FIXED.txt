GEN Z Store - GitHub upload copy

This copy contains source code and a sample product schema, not live server credentials.

Before deploying on InfinityFree:
1. Copy backend/config.example.php to backend/config.php on your local machine or server.
2. Set your database credentials and admin email in the private config.php.
3. Choose a NEW private admin PIN and generate ADMIN_PASSWORD_HASH with PHP password_hash().
4. Copy assets/config.local.example.js to assets/config.local.js. Set the same admin email
   and the SHA-256 hash of the new PIN. This frontend check does not replace backend authentication.
5. Configure your own Google OAuth client ID in backend/config.php if needed.
6. Replace support@example.com, business contact and bank-account placeholders before using payments.
   WhatsApp links currently point to the contact section; configure an intentional business number.
7. Import database/schema.sql. It contains table definitions and sample products only.
8. Upload the deployment files to htdocs, preserving the .htaccess files.

Do not commit backend/config.php, assets/config.local.js, runtime login/order data,
passwords, cookie exports or credentials. The included .gitignore excludes common private files.
Gitignore does not remove files already tracked or present in Git history.

Privacy cleanup:
- Removed live database config and admin credentials/hashes.
- Replaced personal support/admin emails with example.com addresses.
- Removed personal WhatsApp number and deployment OAuth client ID.
- Removed the runtime login-record file (it was empty in the supplied ZIP).
- Replaced contact/payment identifiers with placeholders.

Important: Change the original database password and admin PIN on the live hosting account.
Sanitizing this ZIP does not change the live website or erase previous GitHub uploads.
This is a privacy cleanup, not a complete application security audit.

-- Legacy refresh sessions remain unassured until the user completes MFA again.
ALTER TABLE "refresh_tokens" ADD COLUMN "mfa_verified_at" TIMESTAMP(3);

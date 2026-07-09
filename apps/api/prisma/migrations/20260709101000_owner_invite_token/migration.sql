-- Item 8: platform owner davet tokeni (UserToken purpose, append-only).
ALTER TYPE "UserTokenPurpose" ADD VALUE IF NOT EXISTS 'owner_invite';

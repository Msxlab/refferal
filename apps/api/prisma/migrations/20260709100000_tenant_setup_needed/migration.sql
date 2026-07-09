-- Item 2: yeni sirketler kurulum-bekliyor durumunda acilir (append-only, guvenli).
ALTER TYPE "TenantStatus" ADD VALUE IF NOT EXISTS 'setup_needed';

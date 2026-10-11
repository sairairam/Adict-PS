# Adict-PS
Extracting Information from Data Provided. Autofilling, OCR model application.

See [implementation-architecture.md](implementation-architecture.md) for the design.

## Status
Phase 1 (Foundation): Next.js app, Supabase auth, schema and RLS, upload to private Storage with magic-byte verification and job enqueue.

## Setup
1. Create a Supabase project and run `supabase/migrations/0001_init.sql` (SQL editor or `supabase db push`).
2. Copy `.env.example` to `.env.local` and fill in the Supabase URL, anon key and service-role key.
3. `npm install`, then `npm run dev`.

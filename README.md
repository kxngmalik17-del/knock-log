# KnockLog

Mobile-first door knocking logger for sales reps. Log outcomes in 1-2 taps, backed by Supabase.

**Live:** [https://knock-log.vercel.app](https://knock-log.vercel.app)

## Features

- **Rep accounts** — Supabase email/password auth with persistent sessions
- **1-tap logging** — NO ANSWER, CONVO, QUOTE, SALE buttons
- **Objection tracking** — Quick second-step objection buckets for CONVO outcomes
- **Live metrics** — Today's totals update in real-time
- **Recent log feed** — Newest-first activity view

## Tech Stack

- Vite + React (vanilla JS)
- Supabase (Auth + PostgreSQL)
- CSS (no framework)
- Vercel deployment

## Setup

### 1. Clone

```bash
git clone https://github.com/kxngmalik17-del/knock-log.git
cd knock-log
npm install
```

### 2. Supabase

Run the SQL in `supabase/schema.sql` in your Supabase SQL editor to create the required tables and RLS policies.

### 3. Environment Variables

Copy `.env.example` to `.env` and fill in your Supabase URL and anon key:

```bash
cp .env.example .env
```

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

For Vercel, set these same variables in **Settings → Environment Variables**.

### 4. Run Locally

```bash
npm run dev
```

### 5. Deploy to Vercel

1. Import repo at [vercel.com/new](https://vercel.com/new)
2. Framework: **Vite**
3. Add environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
4. Deploy

## Supabase Schema

See [`supabase/schema.sql`](./supabase/schema.sql) for the full schema including:

- `reps` table — user profiles with display names
- `knocks` table — door knock outcomes and objections
- Row Level Security (RLS) policies — users can only read/write their own data

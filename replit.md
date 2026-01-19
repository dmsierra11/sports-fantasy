# Sports Fantasy

## Overview
A Sports Fantasy application built with React + Express using Vite as the build tool and Supabase for authentication and database.

## Project Architecture

### Tech Stack
- **Frontend**: React 18 with TypeScript
- **Backend**: Express.js (integrated with Vite dev server)
- **Build Tool**: Vite
- **Styling**: TailwindCSS with Radix UI components
- **Auth/Database**: Supabase
- **State Management**: TanStack React Query

### Directory Structure
```
├── client/          # React frontend code
│   ├── components/  # UI components
│   ├── contexts/    # React contexts (AuthContext)
│   ├── hooks/       # Custom hooks
│   ├── lib/         # Utilities and Supabase client
│   └── pages/       # Page components
├── server/          # Express backend
│   ├── lib/         # Server-side utilities
│   └── routes/      # API route handlers
├── shared/          # Shared types and utilities
└── public/          # Static assets
```

### Development
- Run `npm run dev` to start the development server on port 5000
- Frontend and backend are served together via Vite's dev server

### Build & Production
- `npm run build` - Builds both client and server
- `npm run start` - Runs the production server

## Required Environment Variables

### Client-side (prefixed with VITE_)
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous/public key

### Server-side
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (server-only, never expose to client)

## Recent Changes
- 2026-01-19: Configured for Replit environment (port 5000, allowed hosts)

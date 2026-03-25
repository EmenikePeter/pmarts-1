# PMARTS - Pi Escrow Trust System

PMARTS protects Pi users with secure escrow, reducing fraud and building trust in peer-to-peer deals.

## Features

- **Escrow System**: Secure Pi transactions with multi-stage holds and atomic releases
- **Dispute Resolution**: Built-in conflict resolution workflow for transaction disputes
- **Fraud Detection**: Intelligent fraud prevention with recipient validation and placeholder detection
- **Financial Ledger**: Bank-grade transaction tracking with full audit trails
- **Admin Dashboard**: Comprehensive monitoring and management interface
- **API Integration**: RESTful API for third-party escrow integration

## Tech Stack

- **Frontend**: React Native + Expo SDK 55
- **Backend**: Supabase (PostgreSQL + Realtime + Auth)
- **Blockchain**: Pi Network SDK integration

## User Documentation

- [PMARTS App Guide](docs/PMARTS_APP_GUIDE.md) — Full user guide for onboarding, deposits, escrow flows, disputes, support, and best practices.
- [Community Guidelines](docs/COMMUNITY_GUIDELINES.md) — Rules and standards for respectful, honest, and safe use of PMARTS.

## Project Structure

```
pmarts/
├── mobile/              # React Native Expo app (TypeScript)
│   ├── src/
│   │   ├── components/  # Reusable UI components
│   │   ├── screens/     # App screens
│   │   ├── services/    # API and business logic
│   │   ├── lib/         # Utilities and hooks
│   │   └── types/       # TypeScript definitions
│   └── app.json
├── api/                 # Express.js backend API (JavaScript/TypeScript)
│   ├── src/
│   │   ├── routes/      # API endpoints
│   │   ├── lib/         # Core business logic (escrow, payments, fraud)
│   │   └── worker/      # Background job processing
│   └── package.json
├── pmarts-admin/        # Next.js admin dashboard (TypeScript, Tailwind CSS)
│   ├── app/
│   │   ├── dashboard/   # Main dashboard
│   │   ├── disputes/    # Dispute management
│   │   ├── escrows/     # Escrow monitoring
│   │   ├── users/       # User management
│   │   └── api/         # API routes
│   └── package.json
├── docs/                # Architecture and workflow documentation
├── scripts/             # Development utilities and testing tools
└── supabase/
    ├── migrations/      # Database migrations
    └── schema.sql       # Database schema
```

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Expo CLI (for mobile development)
- Supabase account and credentials

### Mobile App
```bash
cd mobile
npm install
npx expo start
```

### API Server
```bash
cd api
npm install
npm start
```
API runs on `http://localhost:4000`

### Admin Dashboard
```bash
cd pmarts-admin
npm install
npm run dev
```
Dashboard runs on `http://localhost:3000`

### Environment Configuration
Create `.env` files in each service with required credentials:
- `SUPABASE_URL` and `SUPABASE_ANON_KEY`
- `PI_API_KEY` for Pi Network integration
- Other service-specific variables (see `.env.example` in each service)

## Database Migrations

The project includes 8 database migrations for the complete fintech-grade schema:
- User management with trust scoring
- Escrow lifecycle tracking
- Payment and ledger entries
- Dispute resolution system
- Fraud detection rules
- API partner integrations

## License

Private - All rights reserved

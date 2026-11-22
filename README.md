# TempFlow

TempFlow is a real-time collaborative diagram editor. Users create flow diagrams on a node-and-edge canvas, share them with teammates through email invitations, and edit together live with presence indicators and role-based permissions.

## Features

- **Diagram editor** built on React Flow (`@xyflow/react`)
- **Real-time collaboration** over Socket.IO: node and edge changes sync instantly between connected clients
- **Presence and collaboration status**: see who is currently in a diagram
- **Role-based access**: collaborators have roles (e.g. viewer / editor), enforced on both the REST API and socket events
- **Invitations by email** (Nodemailer) with pending / accepted status tracking
- **Authentication** with JWT and bcrypt-hashed passwords, plus password reset
- **API docs** served with Swagger UI at `/api-docs`
- **Security basics**: Helmet, CORS, rate limiting on auth routes, Zod request validation

## Tech Stack

| Layer    | Technology                                                        |
| -------- | ----------------------------------------------------------------- |
| Frontend | Next.js 16, React 19, Tailwind CSS 4, React Hook Form, Zod        |
| Backend  | Node.js (ESM), Express 5, Socket.IO, Zod, JWT                     |
| Database | PostgreSQL 16 with Prisma ORM                                     |
| Testing  | Jest + Supertest (backend), Playwright (frontend)                 |
| CI       | GitHub Actions (`backend-ci.yml`, `frontend-ci.yml`)              |

## Project Structure

```
TempFlow/
├── backend/
│   ├── prisma/            # schema.prisma and migrations
│   ├── src/
│   │   ├── config/        # database, mailer, socket, swagger
│   │   ├── controllers/   # auth, diagram, invitation, user
│   │   ├── middleware/    # auth, errors, rate limiting, validation
│   │   ├── routes/
│   │   ├── services/      # business logic
│   │   ├── socket/        # socket auth, handlers (nodes, presence, ...)
│   │   ├── utils/
│   │   └── validators/    # Zod schemas
│   ├── tests/
│   ├── docker-compose.yaml  # local PostgreSQL
│   └── server.js
├── frontend/
│   ├── src/
│   │   ├── app/           # Next.js routes
│   │   ├── components/    # auth, diagrams, editor, ...
│   │   ├── context/  hooks/  lib/  services/  utils/
│   └── tests/             # Playwright tests
└── .github/workflows/
```

## Prerequisites

- Node.js 20+ and npm
- Docker (for the local PostgreSQL database) or any PostgreSQL 16 instance

## Getting Started

### 1. Clone

```bash
git clone https://github.com/amjalabhanu/TempFlow.git
cd TempFlow
```

### 2. Start the database

```bash
cd backend
docker compose -f docker-compose.yaml up -d
```

This starts PostgreSQL 16 on port `5432` (user `project_user`, password `project_password`, database `project_db`). These are local development defaults only.

### 3. Configure and run the backend

```bash
cd backend
cp .env.example .env
npm install
npx prisma migrate deploy
npm run dev
```

Edit `backend/.env`:

| Variable         | Description                                          | Example                                                          |
| ---------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| `PORT`           | API port                                             | `5000`                                                           |
| `DATABASE_URL`   | PostgreSQL connection string                         | `postgresql://project_user:project_password@localhost:5432/project_db` |
| `JWT_SECRET`     | Secret used to sign tokens                           | a long random string                                             |
| `JWT_EXPIRES_IN` | Token lifetime                                       | `1d`                                                             |
| `CLIENT_URL`     | Frontend origin (CORS and invitation links)          | `http://localhost:3000`                                          |
| `MAIL_USER`      | SMTP account used to send invitation / reset emails  |                                                                  |
| `MAIL_PASS`      | SMTP password or app password                        |                                                                  |

The API runs at `http://localhost:5000` and Swagger docs at `http://localhost:5000/api-docs`.

### 4. Configure and run the frontend

```bash
cd frontend
npm install
npm run dev
```

If the frontend needs to know the API address, set it in `frontend/.env.local` (see `frontend/src/lib` and `frontend/src/services` for the variables in use). The app runs at `http://localhost:3000`.

## API Overview

| Prefix              | Purpose                                      |
| ------------------- | -------------------------------------------- |
| `/api/auth`         | Register, login, password reset              |
| `/api/users`        | User profile                                 |
| `/api/diagrams`     | Diagram CRUD, collaborators, invitations     |
| `/api-docs`         | Interactive Swagger documentation            |

Real-time events (joining a diagram room, node/edge operations, presence) are handled by Socket.IO in `backend/src/socket`.

## Data Model

Defined in `backend/prisma/schema.prisma`:

- `User`
- `Diagram` (with a `DiagramVisibility` enum)
- `DiagramCollaborator` (with a `CollaboratorRole` enum)
- `DiagramInvitation` (with an `InvitationStatus` enum)

## Testing

```bash
# Backend (Jest)
cd backend && npm test

# Frontend (Playwright)
cd frontend && npx playwright test
```

The `backend/test-*.js` files are manual Socket.IO scripts for exercising rooms, node operations, presence, and viewer permissions against a running server.

## Scripts

| Location    | Command         | Description                |
| ----------- | --------------- | -------------------------- |
| `backend/`  | `npm run dev`   | Start API with nodemon     |
| `backend/`  | `npm start`     | Start API                  |
| `backend/`  | `npm test`      | Run Jest tests             |
| `frontend/` | `npm run dev`   | Start Next.js dev server   |
| `frontend/` | `npm run build` | Production build           |
| `frontend/` | `npm run lint`  | Lint with ESLint           |

## Contributing

1. Create a feature branch from `dev`
2. Make your changes and add tests where relevant
3. Open a pull request; CI runs the backend and frontend workflows

## License

The backend `package.json` lists ISC. Add a `LICENSE` file to make this explicit.

# STEMAI Backend

Backend API for the STEMAI STEM education platform.

## What is included

- Express REST API
- PostgreSQL database
- Signup/login with bcrypt password hashing
- JWT authentication
- User Class 1-12 profile
- AI Tutor endpoint
- Chat history
- Subject progress
- Quiz attempts
- Feedback
- Health check
- Optional OpenAI-compatible AI provider

## Local setup

1. Install Node.js 18+.
2. Create a PostgreSQL database.
3. Run `schema.sql` in that database.
4. Copy `.env.example` to `.env`.
5. Fill in:
   - DATABASE_URL
   - JWT_SECRET
   - CLIENT_ORIGIN
6. Run:
   npm install
   npm start

Health:
GET /api/health

## Main endpoints

POST /api/auth/signup
POST /api/auth/login
GET  /api/auth/me

POST /api/tutor/ask
GET  /api/tutor/history

GET  /api/progress
PUT  /api/progress

POST /api/quizzes/attempt
GET  /api/quizzes/attempts

POST /api/feedback

Protected endpoints require:
Authorization: Bearer YOUR_JWT_TOKEN

## AI

If `AI_API_KEY` and `AI_MODEL` are empty, `/api/tutor/ask` uses a small demo fallback so the API still works.

For a real AI tutor, set:
AI_API_KEY=...
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=...

Use a provider/model that your account actually has access to.

## Deployment

Deploy this backend to a Node-compatible host such as Render, Railway, Fly.io, or another Node hosting service. Add the environment variables in the host dashboard and connect a hosted PostgreSQL database.

The static frontend must then call the deployed backend URL instead of local `/api` routes.

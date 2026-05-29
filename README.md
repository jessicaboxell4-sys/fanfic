# Shelfsort

[![Backend tests](https://github.com/OWNER/REPO/actions/workflows/backend-tests.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/backend-tests.yml)
[![codecov](https://codecov.io/gh/OWNER/REPO/branch/main/graph/badge.svg?flag=backend)](https://codecov.io/gh/OWNER/REPO)

> Drop EPUBs in. Sort by fandom. Read in-app. Get a weekly digest and a beautiful "Year in Books" recap — shareable with anyone.

A FastAPI + React + MongoDB app that auto-categorises your EPUB library (Fanfiction / Original Fiction / Non-fiction / custom shelves) using Claude AI, extracts every external link, syncs fanfic chapters via FicHub, and tracks your reading.

## Features

- 📚 **EPUB ingest + AI categorisation** (Claude via Emergent LLM key) — fandom, author, series, words count
- 🔗 **URL extraction** to a single downloadable `.txt`
- 🗂️ **Custom shelves**, bulk move/delete, **bulk metadata editing**
- 👤 **Dedicated Author pages** + **Fandom pages** + **Series pages**
- 📖 **In-app Kindle-style EPUB Reader** (paginated, themes, TOC) via `epubjs`
- 📊 **Reading stats**: pages, books finished, streaks, daily heatmap, top fandoms/authors
- 🎁 **Year in Books** — annual recap (in-app + emailable + publicly shareable via signed URL)
- 📬 **Weekly digest email** (opt-in, configurable day/hour) via Resend
- 🔄 **FicHub integration** — auto-update fanfic EPUBs, "Can't find online" recovery flow
- 🔐 **Auth**: Email/Password (bcrypt) + Google OAuth + Resend-based password reset, brute-force protection

## Tech stack

- **Backend**: FastAPI · Motor (async MongoDB) · APScheduler · bcrypt · Resend · ebooklib + BeautifulSoup
- **Frontend**: React · React Router · Tailwind CSS · shadcn/ui · epubjs · Sonner toasts
- **Tests**: pytest + integration suite (124 tests, ~80% coverage). Coverage gate enforced in CI.

## Local development

Services are managed by supervisor. Frontend on `:3000`, backend on `:8001`.

```bash
# Restart after .env changes or new dependencies
sudo supervisorctl restart backend frontend

# Tail logs
tail -f /var/log/supervisor/backend.err.log
```

## Running the test suite

```bash
cd backend
# Integration tests (no coverage)
pytest tests/

# True coverage — starts uvicorn under `coverage run` so the integration
# tests hit an instrumented server. Threshold currently 75%.
./scripts/run_coverage.sh --fail-under=75
```

CI runs the same script on every push/PR and uploads the coverage XML to Codecov.

## Dependency updates

Dependabot opens grouped weekly PRs (Monday 07:00 UTC) for `backend/`, `frontend/`, and GitHub Actions. The `dependabot-auto-merge` workflow:
- Waits for the `pytest` check to pass.
- **Patch + minor** bumps → auto-approved and squash-merged.
- **Major** bumps → left for human review with an explanatory comment.

Tweak `.github/dependabot.yml` for limits/grouping and `.github/workflows/dependabot-auto-merge.yml` for the merge policy.

## Environment

Required (`backend/.env`):

| Var | Purpose |
| --- | --- |
| `MONGO_URL` | Mongo connection string |
| `DB_NAME` | Mongo DB name |
| `EMERGENT_LLM_KEY` | Claude classification |
| `RESEND_API_KEY` | Password reset + digest + year-recap emails (optional) |
| `SENDER_EMAIL` | "from" address (default: `onboarding@resend.dev`) |
| `FRONTEND_URL` | Base URL used in emails + share links |

Required (`frontend/.env`):

| Var | Purpose |
| --- | --- |
| `REACT_APP_BACKEND_URL` | Externally-reachable backend URL |

## Codebase layout

```
backend/
├── server.py              # 50-line FastAPI entry-point
├── deps.py                # shared singletons (app, api_router, db, env)
├── models.py              # User, BookOut
├── auth_dep.py            # get_current_user
├── routes/
│   ├── auth.py            # /api/auth/*
│   ├── books.py           # /api/books/* + EPUB/FicHub/AI helpers
│   ├── stats.py           # /api/stats/*
│   ├── series_categories.py
│   ├── digest.py          # weekly digest + scheduler
│   ├── year.py            # year-in-books + public sharing
│   └── root.py
├── scripts/run_coverage.sh
└── tests/                 # 106 integration tests
frontend/
└── src/
    ├── pages/
    │   ├── Dashboard.jsx, BookDetail.jsx, Reader.jsx
    │   ├── AuthorShelf.jsx, FandomShelf.jsx, SeriesShelf.jsx
    │   ├── StatsPage.jsx, YearInBooksPage.jsx, PublicYearInBooks.jsx
    │   ├── CantFindOnline.jsx, Account.jsx
    │   └── Landing.jsx, Login.jsx, ResetPassword.jsx, AuthCallback.jsx
    └── components/
        ├── BookCard.jsx, Navbar.jsx, UploadZone.jsx
        ├── SelectionBar.jsx, ContinueReadingRail.jsx, StatsCard.jsx
        └── ui/             # shadcn
.github/workflows/backend-tests.yml
```

## Replace `OWNER/REPO` in the badges above with your GitHub slug after pushing.

# Contributing to Shelfsort

The whole point of this doc is one minute of onboarding. If you find yourself reading for longer, something is wrong — open an issue.

---

## The two commands that matter

```bash
# Run the test suite with real coverage. Threshold: 75%.
cd backend && ./scripts/run_coverage.sh

# Restart a service after editing its .env / installing a dep.
sudo supervisorctl restart backend         # or: frontend
```

Code reloads automatically — you only restart for `.env` changes or new dependencies.

---

## Layout

- **Backend** (`backend/`): FastAPI on `:8001`. Each route module under `backend/routes/` registers itself on the shared `api_router` from `deps.py`. All endpoints start with `/api/`.
- **Frontend** (`frontend/`): React on `:3000`. Pages live in `src/pages/`, reusable bits in `src/components/`. Use `process.env.REACT_APP_BACKEND_URL` for API calls — never hard-code.
- **Tests** (`backend/tests/`): integration suite that hits a live uvicorn. Build EPUB fixtures in-memory with the helper in `test_books_comprehensive.py`.

---

## Conventions

### Frontend

- **Every interactive element gets a `data-testid`.** Buttons, links, inputs, dialogs, error messages, toasts, balances — anything a test or user might target. Use kebab-case describing the function, not the styling: `data-testid="bulk-edit-metadata-btn"`, not `data-testid="orange-btn"`.
- shadcn components live in `src/components/ui/`. Import path: `../components/ui/<name>`.
- Toast notifications via `sonner` (already wired).
- Avoid emoji icons in UI; use `lucide-react`.

### Backend

- All routes prefixed `/api`.
- Datetimes: `datetime.now(timezone.utc)` — never `datetime.utcnow()`.
- Cookies: `secure=COOKIE_SECURE, samesite=COOKIE_SAMESITE` (env-controlled so HTTP tests work).
- External services (Resend, FicHub, LLM) must have an env-toggleable test hook so coverage doesn't hit the real network.

### Commits & PRs

- Squash-merge by default — keeps history readable.
- Dependabot opens grouped PRs Mondays at 07:00 UTC; patch/minor bumps auto-merge after `pytest` passes.

---

## Adding a new endpoint

1. Pick the right `routes/*.py` (or create a new module + import it from `server.py`).
2. Decorate with `@api_router.<verb>("/path", ...)`.
3. Write at least one integration test in `tests/` — hit it over HTTP, assert the JSON shape.
4. Run `./scripts/run_coverage.sh` and ensure total stays ≥75%.

## Adding a new external integration

1. Wrap the SDK call in a function that reads an env var to bypass it during tests (see `classify_with_ai` + `SHELFSORT_TEST_AI_RESPONSE` for the pattern).
2. Add the env var to `scripts/run_coverage.sh` and `.github/workflows/backend-tests.yml`.
3. Stay within the **Emergent LLM key** for Claude / Gemini / OpenAI text/image. Don't hardcode model names from older docs — check `routes/books.py` for the current Claude model string.

---

## Where things live (quick map)

| You want to change… | Open this |
| --- | --- |
| EPUB upload behavior | `backend/routes/books.py` (`upload_books`) |
| AI classification prompt | `backend/routes/books.py` (`classify_with_ai`) |
| FicHub integration | `backend/routes/books.py` (`fichub_fetch_epub`, `apply_refresh`) |
| Weekly digest content | `backend/routes/digest.py` (`_build_digest_payload`) |
| Year-in-Books content | `backend/routes/year.py` (`_build_year_payload`) |
| Auth flow / cookies | `backend/routes/auth.py`, `backend/auth_dep.py` |
| In-app reader | `frontend/src/pages/Reader.jsx` |
| Dashboard layout | `frontend/src/pages/Dashboard.jsx` |
| Public share page | `frontend/src/pages/PublicYearInBooks.jsx` |
| CI / coverage | `.github/workflows/backend-tests.yml`, `backend/scripts/run_coverage.sh` |

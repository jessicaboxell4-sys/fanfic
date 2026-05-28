# Test Credentials

## Auth Method: Emergent Google OAuth Only

Shelfsort uses Emergent-managed Google OAuth for authentication. There are no password-based credentials.

## Testing Approach (for testing agent)

Create a test user + session directly in MongoDB, then set the `session_token` cookie:

```bash
mongosh --eval "
use('test_database');
var userId = 'user_test' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'test.user@example.com',
  name: 'Test User',
  picture: 'https://via.placeholder.com/150',
  created_at: new Date().toISOString()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
});
print('Session token: ' + sessionToken);
print('User ID: ' + userId);
"
```

Then use either:
- Cookie: `session_token=<token>` (httpOnly, samesite=none, secure)
- Header: `Authorization: Bearer <token>`

## Key API Endpoints
- GET  /api/auth/me
- POST /api/auth/google  (body: {session_id})
- POST /api/auth/logout
- POST /api/books/upload (multipart files=...)
- GET  /api/books
- GET  /api/books/stats
- GET  /api/books/{book_id}
- GET  /api/books/{book_id}/cover
- GET  /api/books/{book_id}/download
- POST /api/books/{book_id}/reclassify  (body: {use_ai})
- PATCH /api/books/{book_id} (body: {category, fandom})
- DELETE /api/books/{book_id}
- GET  /api/books/export/zip
- GET/POST/DELETE /api/categories

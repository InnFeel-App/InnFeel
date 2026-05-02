# MoodDrop Auth Testing Playbook (JWT Email/Password)

## MongoDB verification
```
mongosh
use test_database
db.users.find().pretty()
db.users.findOne({role:"admin"}, {password_hash:1})
```
Verify bcrypt hash starts with `$2b$`. Indexes: users.email (unique).

## API Testing
```
curl -c cookies.txt -X POST http://localhost:8001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test1@example.com","password":"test12345","name":"Test One"}'

curl -c cookies.txt -X POST http://localhost:8001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@mooddrop.app","password":"admin123"}'

curl -b cookies.txt http://localhost:8001/api/auth/me
```

Login must set `access_token` + `refresh_token` cookies. `/me` returns user object without `password_hash`.

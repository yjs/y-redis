
# Auth by JWT demo

Authentication by [JWT](https://jwt.io) can be a good solution for you if you
have an existing auth mechanism and you want to host y-redis as a separate
instance.

The idea is that the client requests permission to edit a specific document from
YOUR server (which can be implemented in any programming language / server
framework). In this demo, we implemented an `/auth/[room]` endpoint that the
client uses to requests permission to get access to a specific "room". The server may respond
with a JWT containing the room and access type (read-only or read-write):

```js
{
  "iss": "my-auth-server",
  // Access expires in a day
  "exp": Date.now() + 1000 * 60 * 60 * 24, 
  // The "room" that the user is given permission to
  "yroom": "authorized room-name",
  // Set access to either 'rw' or 'readonly'
  "yaccess": 'rw', 
  // Associate the access-jwt with a unique user identifier
  // This can be used to revoke access
  "yuserid": 'user1'
}
```

## Setup

- Register a new OAuth Application in the [GitHub Developer Panel](https://github.com/settings/applications/new)
- Set `homepage` to `http://localhost:3002`
- Set `Authorization callback URL` to `http://localhost:3002/auth/github/callback`
- Store clientid and clientsecret in `y-redis/.env` 
```sh
GITHUB_CLIENT_ID=..
GITHUB_CLIENT_SECRET=..
```
https://github.com/settings/applications/new

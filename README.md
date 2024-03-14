
# y-redis :tophat:
> y-websocket compatible backend using Redis for scalability

y-redis is an alternative backend for y-websocket. It only requires a redis
instance and a storage provider (S3 or Postgres-compatible). 

* **Memory efficient:** The server doesn't maintain a Y.Doc in-memory. It
streams updates through redis. The Yjs document is only loaded to memory for the
initial sync. 
* **Scalable:** You can start as many y-redis instances as you want to handle
a fluctuating number of clients. No coordination is needed.
- **Auth:** y-redis works together with your existing infrastructure to
authenticate clients and check whether a client has read-only / read-write
access to a document.
- **Database agnostic:** You can persist documents in S3-compatible backends, in
Postgres, or implement your own storage provider.

### Components

The y-redis **server component** is responsible for accepting
websocket-connections and distributing the updates on redis.

The separate y-redis **worker component** is responsible for extracting data
from the redis cache to a persistent database like S3 or Postgres. Once the data
is persisted, the worker component cleans up stale data in redis.

You are responsible for providing a REST backend that y-redis will call to check
whether a specific client (authenticated via a JWT token) has access to a
specific room / document.

## Professional support

As this server implementation is clearly intended for startups & large companies
that want a scalable backend to their collaborative product, I thought about
commercializing this piece of software. Ultimately I decided against it, because
permissively licensed software like this has more prositive impact on humanity
overall. However it does make sense to cantact me to evaluate whether this is
the right approach for you.

Please support my work by [becoming a
sponsor](https://github.com/sponsors/dmonad) or hiring me as a consultant for
professional support and security updates.

### Features

I'm looking for sponsors that want to sponsor the following work:

- Ability to kick out users when permissions on a document changed
- Implement configurable docker containers for y-redis server & worker
- Implement helm chart
- More exhaustive logging and reporting of possible issues
- More exhaustive testing
- More exhaustive documentation
- Add support for Bun and Deno
- Perform expensive tasks (computing sync messages) in separate threads

If you are interested in sponsoring some of this work, please send a mail to
<kevin.jahns@pm.me>

## License

[The MIT License](./LICENSE) © Kevin Jahns

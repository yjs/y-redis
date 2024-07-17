
# y-redis :tophat: 
> y-websocket compatible backend using Redis for scalability. **This is beta
> software!**

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

### Licensing

y-redis is dual-licensed (either [AGPL](./LICENSE) or proprietary).

Please contact me to buy a license if you intend to use y-redis in your
commercial product: <kevin.jahns at pm.me>

Otherwise, you may use this software under the terms of the AGPL, which requires
you to publish your source code under the terms of the AGPL too.

### Components

Redis is used as a "cache" and a distribution channel for document updates.
Normal databases are not fast enough for handling real-time updates of
fast-changing applications (e.g. collaborative drawing applications that
generate hundreds of operations per second). Hence a redis-cache for temporary
storage makes sense to distribute documents as fast as possible to all peers.

A persistent storage (e.g. S3 or Postgres) is used to persist document updates
permanently. You can configure in which intervals you want to persist data from
redis to the persistent storage. You can even implement a custom persistent
storage technology.

The y-redis **server component** (`/bin/server.js`) is responsible for accepting
websocket-connections and distributing the updates via redis streams. Each
"room" is represented as a redis stream. The server component assembles updates
stored redis and in the persistent storage (e.g. S3 or Postgres) for the initial
sync. After the initial sync, the server doesn't keep any Yjs state in-memory.
You can start as many server components as you need. It makes sense to put the
server component behind a loadbalancer, which can potentially auto-scale the
server component based on CPU or network usage. 

The separate y-redis **worker component** (`/bin/worker.js`) is responsible for
extracting data from the redis cache to a persistent database like S3 or
Postgres. Once the data is persisted, the worker component cleans up stale data
in redis. You can start as many worker components as you need. It is recommended
to run at least one worker, so that the data is eventually persisted. The worker
components coordinate which room needs to be persisted using a separate
worker-queue (see `y:worker` stream in redis).

You are responsible for providing a REST backend that y-redis will call to check
whether a specific client (authenticated via a JWT token) has access to a
specific room / document. Example servers can be found in
`/bin/auth-server-example.js` and `/demos/auth-express/server.js`.

### Missing Features

I'm looking for sponsors that want to sponsor the following work:

- Ability to kick out users when permissions on a document changed
- Configurable docker containers for y-redis server & worker
- Helm chart
- More exhaustive logging and reporting of possible issues
- More exhaustive testing
- Better documentation & more documentation for specific use-cases
- Support for Bun and Deno
- Perform expensive tasks (computing sync messages) in separate threads

If you are interested in sponsoring some of this work, please send a mail to
<kevin.jahns at pm.me>.

# Quick Start (docker-compose)

You can get everything running quickly using
[docker-compose](https://docs.docker.com/compose/). The compose file runs the
following components:

- redis
- minio as a s3 endpoint
- a single y-redis server
- a single y-redis worker

This can be a good starting point for your application. If your cloud provider
has a managed s3 service, you should probably use that instead of minio. If you
want to use minio, you need to setup proper volumes and backups.

The full setup gives insight into more specialized configuration options.

```sh
git clone https://github.com/yjs/y-redis.git
cd y-redis
npm i
```

### Setup the environment variables

```sh
cp .env.docker.template .env
# generate unique authentication tokens
npx 0ecdsa-generate-keypair --name auth >> .env
```

The sample configuration configures s3 using minio.
Have a look at `.env.template` for more configuration options.

### Run demo

```sh
cd ./demos/auth-express
docker compose up
# open http://localhost:5173 in a browser
```

# Full setup

Components are configured via environment variables. It makes sense to start by
cloning y-redis and getting one of the demos to work.

Note: If you want to use any of the docker commands, feel free to use podman (a
more modern alternative) instead.

#### Start a redis instance

Setup redis on your computer. Follow the [official
documentation](https://redis.io/docs/install/install-redis/). This is
recommended if you want to debug the redis stream.

Alternatively, simply run redis via docker:

```sh
# start the official redis docker container on port 6379
docker run -p 6379:6379 redis
# or `npm run redis`
```

#### Start an S3 instance

Setup an S3-compatible store at your favorite cloud provider.

Alternatively, simply run a *minio* store as a docker container:

```sh
docker run -p 9000:9000 -p 9001:9001 quay.io/minio/minio server /data --console-address \":9001\"
# or `npm run minio`
```

This is just a dev setup. Have a look at the minio documentation if you want to
run it in production.

#### Clone demo

```sh
git clone https://github.com/yjs/y-redis.git
cd y-redis
npm i
```

All features are configurable using environment variables. For local development
it makes sense to setup a `.env` file, that stores project-specific secrets. Use
`.env.template` as a template to setup environment variables. Make sure to read
the documentation carefully and configure every single variable.

```sh
# setup environment variables
cp .env.template .env
nano .env
```

Then you can run the different components in separate terminals:

```sh
# run the server
npm run start:server
# run a single worker in a separate terminal
npm run start:worker
# start the express server in a separater terminal
cd demos/auth-express
npm i
npm start
```

Open [`http://localhost:5173`](http://localhost:5173) in a browser.

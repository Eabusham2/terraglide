# TerraGlide's multiplayer server, as a container. See HOSTING.md, "Docker".
#
#   docker build -t terraglide .
#   docker run -d --name terraglide -p 8080:8080 -v terraglide-data:/data terraglide
#
# Then open http://localhost:8080. The server has no npm dependencies, so the
# image is the Node runtime plus this repository and nothing else: no
# `npm install`, no build stage, nothing to go stale between rebuilds.

FROM node:22-alpine

WORKDIR /app

# Port 8080, every interface, and the data in /data — the volume below, so
# accounts and players outlive the container. Each can be overridden with
# `docker run -e`; TERRAGLIDE_NAME, TERRAGLIDE_JOIN_CODE, TERRAGLIDE_ADMINS,
# TERRAGLIDE_TRUST_PROXY and TURN_URL/TURN_USERNAME/TURN_CREDENTIAL work too.
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

# The whole repository, minus what .dockerignore leaves out. A
# server/config.json, if there is one, comes along with it — so keep secrets
# (the join code, a TURN password) in environment variables, not in that file.
COPY . .

# Build both single-file pages now rather than on first start, so a container
# starts serving at once and the bundle always matches the sources it was
# built from. Then make the data folder, owned by the unprivileged `node` user
# (id 1000) the server runs as.
RUN node tools/bundle.mjs \
 && node tools/online.mjs \
 && mkdir -p /data \
 && chown node:node /data

EXPOSE 8080
VOLUME ["/data"]

# /healthz answers "ok" as soon as the server is listening. busybox wget is in
# the alpine image already; 127.0.0.1 rather than localhost, which can resolve
# to ::1 where the server is not listening.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1

# Start as root for one moment, make sure the data folder belongs to `node`,
# then become `node` for good, with busybox's own `su` — it is already in the
# image, so building needs no package downloads, and it replaces itself with
# the server rather than staying around as its parent, so the server is still
# the container's first process and the signal `docker stop` sends reaches it.
#
# Why not simply `USER node`: a named Docker volume copies the image's
# ownership of /data and works either way, but a Fly.io volume or a host
# folder mounted with -v can arrive owned by root, and the server would then
# stop at once with "EACCES: permission denied, mkdir '/data/players'". This
# hands it over first. Only what is not already `node`'s is touched, so
# restarts on a big data folder stay instant. Started with --user (not root),
# it skips all that and runs the command as given.
# (The `--` matters: without it su would read a command's own options, such
# as --reset-password, as options of its own.)
ENTRYPOINT ["/bin/sh", "-c", "if [ \"$(id -u)\" = 0 ]; then mkdir -p \"$DATA_DIR\" && find \"$DATA_DIR\" ! -user node -exec chown node:node {} +; exec su -s /bin/sh -c 'exec \"$0\" \"$@\"' -- node \"$@\"; fi; exec \"$@\"", "terraglide"]

# The server handles SIGTERM, so `docker stop` saves everything before it
# exits. Any other command given to `docker run` replaces this one and runs as
# `node` too — the password reset in HOSTING.md uses that.
CMD ["node", "server/server.mjs"]

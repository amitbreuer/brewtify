# Brewtify
Playlists Brewery for Spotify

## Linux build verification

The **Linux Docker build** pull-request check builds both stages of the production
image without cloud credentials, publishing, or deployment. To run the same check
locally with Docker:

```bash
docker build --pull --platform linux/amd64 --progress=plain --tag brewtify:ci .
```

The builder explicitly includes development and optional dependencies and loads
the Rolldown, Tailwind Oxide, Lightning CSS, and Rollup native bindings before
compilation. If installation or binding loading fails, it prints the captured
verbose npm log before exiting. Check this log for skipped packages and download
or installation failures. A "Cannot find native binding" error alone does not
prove that the lockfile is missing platform
entries. Preserve the committed dependency versions when investigating; do not
delete and regenerate the lockfile or upgrade packages as a first response.

## Party Queue pilot

The existing Telegram Mini App includes a feature-gated cross-service Party Queue.
See [setup, privacy, deployment and release gates](docs/party-queue.md) before enabling
`PARTY_ENABLED`. Library credentials and playback-only Party authorization are separate.

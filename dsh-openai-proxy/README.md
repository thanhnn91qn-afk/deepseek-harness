# dsh-openai-proxy

OpenAI-compatible `/v1/chat/completions` wrapper around a local `dsh` (DeepSeek Harness) headless agent. Point any OpenAI-client app at this server instead of `api.openai.com`.

It does not modify the harness — it shells out to the built `dsh` CLI (`--profile headless`) as a subprocess per request and translates the result into the OpenAI response shape. It lives inside this `deepseek-harness` checkout, as a sibling of `apps/`.

No authentication. By default it binds to `127.0.0.1` only (not reachable from the LAN); see [LAN access and its risk](#lan-access-and-its-risk) before changing that.

## How it works

1. Client sends a standard OpenAI chat-completions request.
2. The proxy takes the **last `user` message's text** as the one-shot task.
3. It runs `node <deepseek-harness>/apps/cli/lib/bin.js --profile headless "<task>"`.
4. `dsh` answers using whatever provider/model is configured as the deployment default in `$DSH_HOME/settings.yaml` (this proxy does not forward the request's `model` field to `dsh`, it only echoes it back for display).
5. The final text is wrapped as a `chat.completion` (or streamed as a handful of `chat.completion.chunk` SSE events if `stream: true` — `dsh` headless mode only returns the final answer, not real token-by-token streaming, so the whole answer arrives as one chunk followed by a `stop` chunk and `[DONE]`).

## Requirements

- This `deepseek-harness` checkout built (`pnpm install && pnpm run build` from the repo root, or run `setup.bat`).
- `$DSH_HOME/settings.yaml` configured with your provider/model (e.g. a local LM Studio endpoint) and `agent-default-model` pointing at it.
- Node.js.

## Run

Started automatically by `DshStack.exe` (see the repo root), or manually:

```sh
npm install
npm start
```

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | HTTP port. |
| `BIND_HOST` | `127.0.0.1` | Interface to listen on. Set to `0.0.0.0` to accept LAN connections — see the security warning below first. |
| `DSH_BIN_PATH` | `../apps/cli/lib/bin.js` | Path to the built `dsh` CLI entry point. |
| `DSH_CWD` | `./workspace` | Working directory `dsh` runs in (its default filesystem workspace). |
| `DSH_TIMEOUT_MS` | `120000` | Kill the `dsh` subprocess if it doesn't finish in time. |
| `MODEL_NAME` | `dsh-agent` | Cosmetic value returned in the response's `model` field. |
| `LMSTUDIO_API_KEY` | `lm-studio` | Placeholder credential passed to the `dsh` subprocess for the `lmstudio` provider route. |

## Test with curl

Non-streaming:

```sh
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma",
    "messages": [{"role": "user", "content": "What is the capital of Vietnam?"}]
  }'
```

Streaming (SSE):

```sh
curl -N http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma",
    "stream": true,
    "messages": [{"role": "user", "content": "Say OK."}]
  }'
```

## Point your app at it

Configure your app the same way you would for OpenAI, but with:

- `base_url`: `http://127.0.0.1:8787/v1`
- `api_key`: any non-empty string (ignored — no auth check)

## LAN access and its risk

By default this proxy (and `dsh web` itself) only accept connections from the same machine. `dsh`'s own web app *refuses* to bind a LAN interface for a documented reason:

> `--host 0.0.0.0 is intentionally not supported yet for safety: it would expose remote code execution to the network`

The `dsh` agent can run shell commands and edit files on the host machine. Neither `dsh web` nor this proxy have a login or API-key check. Opening either to the LAN means **any device on that network can drive the agent and run arbitrary commands on this machine** — there is no authentication layer to stop them, only reachability.

`../enable-lan-access.bat` (repo root, run as Administrator) does open both up anyway — for a home LAN you fully trust, that may be an acceptable trade-off. It requires typing `YES` to confirm and prints the exact commands to undo it afterward. Read the warning it prints before typing `YES`.

## Known limitations

- Only the last `user` message is sent to `dsh`; prior conversation turns, `system` messages, and multi-turn history are not forwarded (each request is a fresh `dsh` headless session).
- No real token streaming — `stream: true` returns the complete answer as one SSE chunk.
- `usage` token counts are always `0` (`dsh` headless mode doesn't report them).
- The request's `model` field does not select the `dsh` provider/model; that's controlled by `$DSH_HOME/settings.yaml`'s `agent-default-model` section on the harness side.
- No auth, ever — see [LAN access and its risk](#lan-access-and-its-risk).

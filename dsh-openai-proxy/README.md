# dsh-openai-proxy

OpenAI-compatible `/v1/chat/completions` wrapper around a local [`dsh`](../deepseek-harness) (DeepSeek Harness) headless agent. Point any OpenAI-client app at this server instead of `api.openai.com`.

It does not modify the `deepseek-harness` checkout — it shells out to the built `dsh` CLI (`--profile headless`) as a subprocess per request and translates the result into the OpenAI response shape.

No authentication — this is meant for `127.0.0.1` only, on a personal/dev machine. The server binds to `127.0.0.1`, not `0.0.0.0`, so it isn't reachable from the LAN.

## How it works

1. Client sends a standard OpenAI chat-completions request.
2. The proxy takes the **last `user` message's text** as the one-shot task.
3. It runs `node <deepseek-harness>/apps/cli/lib/bin.js --profile headless "<task>"`.
4. `dsh` answers using whatever provider/model is configured as the deployment default in `$DSH_HOME/settings.yaml` (this proxy does not forward the request's `model` field to `dsh`, it only echoes it back for display).
5. The final text is wrapped as a `chat.completion` (or streamed as a handful of `chat.completion.chunk` SSE events if `stream: true` — `dsh` headless mode only returns the final answer, not real token-by-token streaming, so the whole answer arrives as one chunk followed by a `stop` chunk and `[DONE]`).

## Requirements

- `deepseek-harness` cloned and built (`pnpm install && pnpm run build`) as a sibling directory (default expected at `../deepseek-harness`).
- `$DSH_HOME/settings.yaml` configured with your provider/model (e.g. a local LM Studio endpoint) and `agent-default-model` pointing at it.
- Node.js.

## Run (one file)

Double-click **`run.cmd`** in this folder. First run installs dependencies automatically, then starts the server at `http://127.0.0.1:8787/v1`. Leave the window open while you use it; close it to stop the server.

## Run (manual)

```sh
npm install
npm start
```

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | HTTP port. |
| `DSH_BIN_PATH` | `../deepseek-harness/apps/cli/lib/bin.js` | Path to the built `dsh` CLI entry point. |
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

## Known limitations

- Only the last `user` message is sent to `dsh`; prior conversation turns, `system` messages, and multi-turn history are not forwarded (each request is a fresh `dsh` headless session).
- No real token streaming — `stream: true` returns the complete answer as one SSE chunk.
- `usage` token counts are always `0` (`dsh` headless mode doesn't report them).
- The request's `model` field does not select the `dsh` provider/model; that's controlled by `$DSH_HOME/settings.yaml`'s `agent-default-model` section on the harness side.
- No auth. Do not expose this port beyond `127.0.0.1`.

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

## Obsidian vault (knowledge base for the agent)

`GET /vault` serves a small upload page: pick a `.docx`, `.pdf`, `.md`, or `.txt` file and it's converted to Markdown (`.docx` via `mammoth`+`turndown`, `.pdf` via `pdf-parse`, `.md`/`.txt` saved as-is) and written into the vault folder (`VAULT_DIR`, default `~/Documents/dsh-vault`).

That same folder is what the `vault` MCP server (`mcp-server-filesystem`, wired into `$DSH_HOME/cordis.patch.yml` by `setup.bat`) gives the `dsh` agent read/write access to, and what you open as an Obsidian vault (Obsidian itself is not required — it's just a nice viewer for the same `.md` files) to browse the same notes with graph view, backlinks, etc.

| Variable | Default | Purpose |
|---|---|---|
| `VAULT_DIR` | `~/Documents/dsh-vault` | Folder the upload page writes converted notes into. Must match the `vault` MCP server's path for the agent to see them. |

**No file-type/content validation beyond extension** — a `.docx`/`.pdf` upload is parsed by `mammoth`/`pdf-parse`, both of which handle untrusted input defensively, but treat this the same as any other upload endpoint: don't expose it to the LAN unless you also accept [the LAN risk below](#lan-access-and-its-risk) for the vault's contents.

## Point your app at it

Configure your app the same way you would for OpenAI, but with:

- `base_url`: `http://127.0.0.1:8787/v1`
- `api_key`: any non-empty string (ignored — no auth check)

## LAN access and its risk

`DshStackLauncher` starts both this proxy and `dsh web` bound to `0.0.0.0` (all interfaces) by default — no extra setup needed, they're reachable from the LAN as soon as the launcher runs.

Upstream `deepseek-ai/deepseek-harness` normally *refuses* to bind `dsh web` to a LAN interface at all:

> `--host 0.0.0.0 is intentionally not supported yet for safety: it would expose remote code execution to the network`

This fork removes that refusal (see [`packages/bundle/web-app/src/startup.ts`](../packages/bundle/web-app/src/startup.ts)) because the whole point of this deployment is LAN reachability. The risk described in that message is real and unchanged: the `dsh` agent can run shell commands and edit files on the host machine, and **neither `dsh web` nor this proxy have a login or API-key check**. Any device on the same LAN can drive the agent and run arbitrary commands on this machine. Only run this on a network you fully trust.

To go back to `127.0.0.1`-only, remove `--host 0.0.0.0` from the `dsh web` launch args and `BIND_HOST=0.0.0.0` from the proxy's env in [`DshStackLauncher/Form1.cs`](../DshStackLauncher/Form1.cs), then rebuild.

## Known limitations

- Only the last `user` message is sent to `dsh`; prior conversation turns, `system` messages, and multi-turn history are not forwarded (each request is a fresh `dsh` headless session).
- No real token streaming — `stream: true` returns the complete answer as one SSE chunk.
- `usage` token counts are always `0` (`dsh` headless mode doesn't report them).
- The request's `model` field does not select the `dsh` provider/model; that's controlled by `$DSH_HOME/settings.yaml`'s `agent-default-model` section on the harness side.
- No auth, ever — see [LAN access and its risk](#lan-access-and-its-risk).

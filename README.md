# DeepSeek Harness — fork cá nhân (tiếng Việt)

Đây là bản fork của [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), với 4 phần bổ sung trên nền dự án gốc `dsh`. Nội dung gốc bằng tiếng Anh của dsh nằm ở phần dưới.

## 1. Giao diện tiếng Việt

Thêm `vi` làm ngôn ngữ thứ 3 bên cạnh `zh`/`en` cho Web UI, phủ toàn bộ 25 namespace locale đã đăng ký (settings, conversation, workspace, model selection, công cụ dev Cordis, v.v.). Chọn tại **Settings → Language → Tiếng Việt**.

## 2. `dsh-openai-proxy/`

Server Express nhỏ, expose endpoint chuẩn OpenAI `POST /v1/chat/completions` (hỗ trợ cả `stream: true` dạng SSE), phía sau gọi một agent `dsh --profile headless` chạy dưới dạng subprocess. Nhờ đó bất kỳ app nào nói được API của OpenAI đều có thể gọi vào agent `dsh` — và qua đó gọi tới bất kỳ model local nào tương thích OpenAI (LM Studio, Ollama...) đã cấu hình làm provider cho `dsh` — mà không cần sửa gì phía client. Xem [`dsh-openai-proxy/README.md`](dsh-openai-proxy/README.md).

## 3. `DshStackLauncher/`

Launcher desktop C#/WinForms rất nhẹ (~170 KB), khởi động và theo dõi cùng lúc Web UI của `dsh` lẫn proxy OpenAI từ một cửa sổ duy nhất — không mở console riêng, log gộp realtime, nút Start/Stop riêng từng service, dùng Windows Job Object để đảm bảo tiến trình con luôn được dọn sạch kể cả khi launcher bị force-kill hoặc crash.

**Tham số chỉnh được:** sửa `dsh-stack-settings.json` (cạnh `DshStack.exe`, tự sinh lần chạy đầu, có ghi chú tiếng Việt) rồi khởi động lại — không cần build lại exe.

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `ProxyTimeoutMs` | `600000` (10 phút) | Proxy chờ `dsh` trả lời bao lâu trước khi huỷ yêu cầu qua `/v1`. Prompt phân tích dài trên model 12B local dễ vượt mốc mặc định gốc (2 phút) của proxy. |

## 4. Vault Obsidian (bộ nhớ kiến thức cho agent)

Trang `http://127.0.0.1:8787/vault` (nút "Nạp kiến thức vào vault" trong `DshStack.exe`) cho phép upload `.docx`/`.pdf`/`.md`/`.txt`, tự convert sang Markdown, lưu vào `~/Documents/dsh-vault`. `setup.bat` tự cấu hình 1 MCP server (`mcp-server-filesystem`) trỏ đúng thư mục đó, nên agent `dsh` đọc/ghi được note trực tiếp. Mở cùng thư mục đó bằng app Obsidian (tự cài, xem [dsh-openai-proxy/README.md](dsh-openai-proxy/README.md#obsidian-vault-knowledge-base-for-the-agent)) để xem đẹp hơn — Obsidian chỉ là trình xem, không bắt buộc để agent hoạt động.

## Cài đặt nhanh (Windows)

```sh
git clone https://github.com/thanhnn91qn-afk/deepseek-harness.git
cd deepseek-harness
setup.bat
```

`setup.bat` tự cài pnpm (nếu thiếu), cài dependency, build `dsh`, build proxy, và build `DshStackLauncher` thành `DshStack.exe`. Xong thì chạy `DshStack.exe` là có cả Web UI lẫn proxy.

## Truy cập qua LAN — mặc định đã bật, và có rủi ro thật

`DshStackLauncher` khởi động cả Web UI (`3080`) lẫn proxy (`8787`) nghe trên **tất cả interface** (`0.0.0.0`), không cần chạy thêm gì. Upstream `deepseek-ai/deepseek-harness` **cố tình chặn cứng** `--host 0.0.0.0` vì agent của `dsh` chạy được lệnh shell, sửa file trên máy — fork này đã **gỡ bỏ** chặn đó (xem [`packages/bundle/web-app/src/startup.ts`](packages/bundle/web-app/src/startup.ts)) để phục vụ đúng nhu cầu chạy trong mạng nhà.

**Không có đăng nhập nào** ở cả Web UI lẫn proxy. Nghĩa là **bất kỳ thiết bị nào trong cùng mạng LAN (kể cả thiết bị lạ, IoT, khách...) đều có thể mở trình duyệt vào và điều khiển máy này qua agent** — chạy lệnh, đọc/sửa file tùy ý. Chỉ dùng trên mạng bạn tin cậy tuyệt đối. Muốn quay lại chỉ nghe `127.0.0.1` thì sửa `--host 0.0.0.0` thành `--host 127.0.0.1` và bỏ `BIND_HOST=0.0.0.0` trong [`DshStackLauncher/Form1.cs`](DshStackLauncher/Form1.cs), build lại.

Fork này còn gỡ thêm **1 lớp bảo vệ nữa**: mặc định upstream luôn khoá `127.0.0.1`-only cho nhóm API cấu hình/credential (`settings.*`, `credentials.*`, `agentPreset.read/copy/remove`, `host.pickDirectory/openPath`, `llm.discoverModels`) — kể cả khi đã khai `trustedHosts` — vì `trustedHosts` chỉ chống DNS-rebinding, không phải xác thực thật. Fork này đã cho nhóm này đi qua cùng `trustedHosts` như mọi API khác (xem [`packages/client/connection/src/index.ts`](packages/client/connection/src/index.ts), `PRIVILEGED_METHODS`), để Settings/Models dùng được từ LAN. Hệ quả: **bất kỳ máy nào trong LAN cũng đọc được có credential nào đang cấu hình, sửa được toàn bộ cấu hình app, duyệt được đường dẫn ổ đĩa máy chủ**. Chỉ nên bật nếu mạng nhà tin cậy tuyệt đối.

---

Toàn bộ phần trên là bổ sung thêm; không có gì trong `packages/`, `apps/` hay các thư mục gốc khác của upstream bị xóa (ngoại trừ phần đã sửa để thêm locale tiếng Việt — xem lịch sử commit để biết chi tiết diff so với `master` gốc của deepseek-ai).

---
---

# DeepSeek Harness (nội dung gốc, tiếng Anh)

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI, served at `http://127.0.0.1:3080` by default. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

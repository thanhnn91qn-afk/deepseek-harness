# DeepSeek Harness — fork cá nhân (tiếng Việt)

Đây là bản fork của [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), với 3 phần bổ sung trên nền dự án gốc `dsh`. Nội dung gốc bằng tiếng Anh của dsh nằm ở phần dưới.

## 1. Giao diện tiếng Việt

Thêm `vi` làm ngôn ngữ thứ 3 bên cạnh `zh`/`en` cho Web UI, phủ toàn bộ 25 namespace locale đã đăng ký (settings, conversation, workspace, model selection, công cụ dev Cordis, v.v.). Chọn tại **Settings → Language → Tiếng Việt**.

## 2. `dsh-openai-proxy/`

Server Express nhỏ, expose endpoint chuẩn OpenAI `POST /v1/chat/completions` (hỗ trợ cả `stream: true` dạng SSE), phía sau gọi một agent `dsh --profile headless` chạy dưới dạng subprocess. Nhờ đó bất kỳ app nào nói được API của OpenAI đều có thể gọi vào agent `dsh` — và qua đó gọi tới bất kỳ model local nào tương thích OpenAI (LM Studio, Ollama...) đã cấu hình làm provider cho `dsh` — mà không cần sửa gì phía client. Xem [`dsh-openai-proxy/README.md`](dsh-openai-proxy/README.md).

## 3. `DshStackLauncher/`

Launcher desktop C#/WinForms rất nhẹ (~170 KB), khởi động và theo dõi cùng lúc Web UI của `dsh` lẫn proxy OpenAI từ một cửa sổ duy nhất — không mở console riêng, log gộp realtime, nút Start/Stop riêng từng service, dùng Windows Job Object để đảm bảo tiến trình con luôn được dọn sạch kể cả khi launcher bị force-kill hoặc crash.

## Cài đặt nhanh (Windows)

```sh
git clone https://github.com/thanhnn91qn-afk/deepseek-harness.git
cd deepseek-harness
setup.bat
```

`setup.bat` tự cài pnpm (nếu thiếu), cài dependency, build `dsh`, build proxy, và build `DshStackLauncher` thành `DshStack.exe`. Xong thì chạy `DshStack.exe` là có cả Web UI lẫn proxy.

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

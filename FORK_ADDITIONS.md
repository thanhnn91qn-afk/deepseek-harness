# Về fork này

Đây là bản fork cá nhân của [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), với 2 phần bổ sung trên nền dự án gốc `dsh`.

## 1. Giao diện tiếng Việt (vi) — nhánh `add-vietnamese-locale`

Thêm `vi` làm ngôn ngữ thứ 3 bên cạnh `zh`/`en`, phủ toàn bộ 25 namespace locale đã đăng ký (settings, conversation, workspace, model selection, công cụ dev Cordis, v.v.). Chọn tại **Settings → Language → Tiếng Việt** trong Web UI.

## 2. `dsh-openai-proxy/`

Một server Express nhỏ, expose endpoint chuẩn OpenAI `POST /v1/chat/completions` (hỗ trợ cả `stream: true` dạng SSE), phía sau gọi một agent `dsh --profile headless` chạy dưới dạng subprocess. Nhờ đó bất kỳ app nào nói được API của OpenAI đều có thể gọi vào agent `dsh` — và qua đó gọi tới bất kỳ model local nào tương thích OpenAI (LM Studio, Ollama...) đã cấu hình làm provider cho `dsh` — mà không cần sửa gì phía client.

Xem [`dsh-openai-proxy/README.md`](dsh-openai-proxy/README.md) để biết cách cài đặt và sử dụng.

## 3. `DshStackLauncher/`

Một launcher desktop viết bằng C#/WinForms, rất nhẹ (~170 KB), khởi động và theo dõi cùng lúc cả Web UI của `dsh` lẫn proxy OpenAI từ một cửa sổ duy nhất — không mở console riêng, log gộp hiển thị realtime, nút Start/Stop riêng từng service, và dùng Windows Job Object để đảm bảo 2 tiến trình `node` con luôn được dọn sạch kể cả khi launcher bị force-kill hoặc crash.

Build bằng lệnh: `dotnet publish -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true`.

---

Tất cả các phần trên đều là bổ sung thêm; không có gì trong `packages/`, `apps/`, hay bất kỳ thư mục gốc nào của upstream bị xóa hay sửa đổi (ngoại trừ phần locale tiếng Việt). Xem nhánh `add-vietnamese-locale` để biết chi tiết diff so với `master` của upstream.

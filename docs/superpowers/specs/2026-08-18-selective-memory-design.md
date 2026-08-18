# Trí nhớ có chọn lọc cho dsh harness

Ngày: 2026-08-18

## Mục tiêu

Biến harness thành một lớp giúp model local (`gemma-4-12b` qua LM Studio) làm
việc tốt dần lên sau mỗi lần rà soát, thay vì bắt đầu lại từ số 0 mỗi phiên.

Bối cảnh vận hành: chủ yếu gọi qua API (`/v1`), tự động rà soát **hàng trăm hồ
sơ ra viện mỗi ngày**. Yêu cầu của người dùng: có ghi nhớ, nhưng **không được
phình dữ liệu và sinh rác**, và **không phải can thiệp thủ công**.

## Nguyên tắc quyết định kiến trúc

**Rà soát 500 hồ sơ không được sinh ra 500 ghi chú.** Thứ đáng nhớ sau 500 lần
rà không phải nội dung từng hồ sơ, mà là *quy luật* rút ra: "khoa Sản hay thiếu
đánh giá nguy cơ băng huyết". Trí nhớ vì thế **đứng yên về kích thước, đặc dần
về chất**.

**Model chỉ làm việc nó làm được.** 12B không đáng tin khi phải tự phán đoán
"cái này có đáng nhớ không" giữa dòng. Nên: code tất định lo đếm, gộp, thăng
hạng, hết hạn, cắt trần; model chỉ diễn đạt một câu cho cụm đã được code gom.

**Chỉ mục rẻ, thân note theo yêu cầu.** Nhồi cả nội dung vào context làm 12B
loãng và kém đi. Chỉ mục chỉ 1 dòng/luật; agent đọc file đầy đủ qua vault MCP
khi cần.

## Kiến trúc

```
POST /v1/chat/completions (hồ sơ trong prompt)
   → dsh headless  → trả kết quả cho client (không đổi)
   → (async) appendVerdict: khử định danh, cắt 600 ký tự
                            → $DSH_HOME/memory/verdicts.jsonl

Định kỳ (mặc định 3 giờ, hoặc POST /memory/consolidate)
   → đọc verdict theo lô 20
   → 1 lần gọi LLM/lô: tìm mẫu lặp → JSON [{code, text, times}]
   → upsertRule: gộp theo code, thăng hạng ≥3, cắt trần 80, hết hạn nháp 30 ngày
   → writeIndex → $DSH_HOME/AGENTS.md

Phiên sau (mọi lần gọi API)
   → dsh-agent-instructions nạp AGENTS.md → agent biết mình đã học gì
```

### Các module

| File | Trách nhiệm |
|---|---|
| `memory/scrub.js` | Khử định danh. Lớp bảo vệ chính. |
| `memory/verdicts.js` | Log verdict đã khử định danh, có xoay vòng. |
| `memory/rules.js` | Kho luật có trần: gộp, thăng hạng, hết hạn, cắt. |
| `memory/index-file.js` | Sinh khối chỉ mục trong `AGENTS.md`. |
| `memory/consolidate.js` | Gọi LLM theo lô, phân tích/kiểm định JSON. |
| `memory/router.js` | `/memory/rules`, `/consolidate`, `/tidy` + hẹn giờ. |

### Tham số

Tất cả đều là **cài đặt chỉnh được**, không phải hằng số: mức nào là "đủ nhiều"
phụ thuộc khối lượng thực tế, nên giá trị dưới đây chỉ là ước lượng khởi đầu.

| Tham số | Mặc định | Khoảng | Lý do chọn |
|---|---|---|---|
| `maxRules` | 80 | 1–5000 | Trần cứng; vượt thì loại luật yếu nhất. |
| `promoteAt` | 3 | 1–100 | Gặp 1 lần là nháp, 3 lần mới thành luật. |
| `draftTtlDays` | 30 | 1–3650 | Nháp không tái xuất hiện thì tự rụng. |
| `chunkSize` | 20 | 1–100 | Vừa với context dùng được của 12B. |
| `minVerdicts` | 5 | 1–10000 | Dưới ngưỡng này chưa thấy được mẫu. |
| `intervalMs` | 3 giờ | 0–7 ngày | Vài lần/ngày là đủ cho vài trăm hồ sơ. |
| `maxVerdictChars` | 600 | 80–5000 | Đủ để gom cụm, thiếu để dựng lại hồ sơ. |

Nguồn đọc theo thứ tự: mặc định → `$DSH_HOME/memory/config.json` → biến môi
trường. File tự sinh lần chạy đầu kèm mô tả tiếng Việt từng tham số.

**Hiệu lực hồi tố.** `readRules` tính lại trạng thái nháp từ `count` so với
`promoteAt` *hiện tại* thay vì tin cờ đã ghi trong file, nên hạ ngưỡng là các
luật đủ điều kiện được thăng hạng ngay, không phải chờ lần gặp sau.

**Chống giá trị hỏng.** `Number(null)`, `Number('')`, `Number(false)` đều ra `0`,
mà `0` kẹp về `promoteAt: 1` — tức mọi quan sát đơn lẻ thành luật chính thức,
đúng thứ thiết kế này sinh ra để tránh. Nên chỉ số thật và chuỗi số mới được
nhận; thứ khác rơi về giá trị cũ và bị liệt kê trong `rejected`.

## Chống rác

Bốn cơ chế, tất cả nằm ở code tất định:

1. **Gộp thay vì thêm** — cùng `code` thì tăng bộ đếm, không tạo note mới.
2. **Ngưỡng thăng hạng** — nháp không vào chỉ mục, nên không ảnh hưởng model.
3. **Hết hạn** — nháp quá 30 ngày không tái xuất hiện thì bị xoá.
4. **Trần cứng** — quá 80 luật thì loại yếu nhất (nháp trước, rồi ít gặp nhất,
   rồi lâu chưa xác nhận nhất).

## Bảo vệ dữ liệu

### Ranh giới

`memory/` chỉ chứa **quy luật đã khử định danh**. Nội dung hồ sơ đi qua agent →
LM Studio (máy nội bộ, dữ liệu không rời viện) → verdict, **không đọng lại**.
Prompt chứa hồ sơ **không được ghi ra bất kỳ đâu** — chỉ kết luận của agent.

### Khử định danh

`scrub.js` bắt: tên người sau nhãn tiếng Việt (kể cả khi model bọc Markdown),
thẻ BHYT, CCCD/CMND, ngày tháng, số điện thoại, mã hồ sơ, địa chỉ đường phố.

Hai điểm học được từ chạy thật:

- Cờ `i` trên regex làm `\p{Lu}` khớp cả chữ thường (JS case-folding) → nuốt
  nhầm các từ sau tên. Đã bỏ cờ `i`, sinh biến thể hoa/thường cho riêng nhãn.
- Model trả lời bằng Markdown, nên `**Nguyễn Thị Hoa**` và `Họ và tên:** Tên`
  là dạng thường gặp chứ không phải ngoại lệ. Đã cho phép `*_:-` giữa nhãn và
  tên, **và** lan truyền: tên học được từ một lần có nhãn sẽ bị xoá ở mọi lần
  xuất hiện khác, kể cả không nhãn.

`upsertRule` còn chạy khẳng định `looksIdentifying` trước khi ghi, nên một lỗ
hổng của scrubber thành "mất một luật" chứ không thành rò rỉ.

### Rủi ro được chấp nhận có chủ đích

Người dùng đã chọn **giữ nguyên các cổng LAN đang mở** sau khi được nêu rõ:
proxy bind `0.0.0.0`, `/vault` và `/memory` CORS `*` không xác thực, dsh web mở
với quyền shell. Hệ quả: bất kỳ máy nào trong mạng viện đều đọc được luật đã
tích luỹ và dùng được agent.

Vì vậy **khử định danh là lớp bảo vệ chính, không phải lớp phụ**. Log verdict cố
tình đặt ngoài vault (`$DSH_HOME/memory/`) và không phục vụ qua HTTP.

## Kiểm chứng đã thực hiện

- **Đọc lại**: đặt sự thật chỉ có trong `~/.dsh/AGENTS.md`, chạy headless, model
  trả lời đúng → vòng lặp đọc khép kín.
- **48 test đơn vị** cho scrub / rules / index / verdicts / consolidate.
- **Đầu-cuối với dữ liệu giả**: 18 nhận xét (3 mẫu lặp + 5 nhiễu) → đúng 3 luật,
  đếm chính xác 6/4/3, nhiễu bị loại sạch.
- **Đầu-cuối qua `/v1` thật**: verdict được ghi tự động, đã khử định danh, nội
  dung lâm sàng còn nguyên.

## Việc chưa làm

- Mặt duyệt trong giao diện Vault (hiện xem qua `/memory/rules` hoặc mở thẳng
  file `.md` bằng Obsidian).
- Chưa đo được trí nhớ tích luỹ có làm chất lượng rà soát tốt lên bao nhiêu —
  cần dữ liệu thật chạy một thời gian mới đánh giá được.

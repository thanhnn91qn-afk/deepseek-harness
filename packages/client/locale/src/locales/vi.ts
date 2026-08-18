import type { CommonKey } from './zh.ts'

/** vi dictionary for the common namespace, checked complete against the zh key set. */
export const vi = {
  'ok': 'Đồng ý',
  'cancel': 'Hủy',
  'close': 'Đóng',
  'copy': 'Sao chép',
  'copied': 'Đã sao chép',
  'retry': 'Thử lại',
  'loading': 'Đang tải…',
  'load.failed': 'Tải thất bại',
  'submit': 'Gửi',
  'submitting': 'Đang gửi…',
  'next': 'Tiếp theo',
  'previous': 'Trước đó',
  'skip': 'Bỏ qua',
  'delete': 'Xóa',
  'edit': 'Sửa',
  'save': 'Lưu',
  'search': 'Tìm kiếm',
  'more': 'Thêm',
  'collapse': 'Thu gọn',
  'expand': 'Mở rộng',
  'back': 'Quay lại',
  'unknown': 'Không xác định',
  'none': 'Không có',
  'truncated': 'Đã cắt bớt',
} satisfies Record<CommonKey, string>

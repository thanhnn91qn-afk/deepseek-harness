/** Vault knowledge-base panel dictionaries. */

export const NS = 'vault'

/** Simplified Chinese vault panel messages (source of truth for the key set). */
export const zh = {
  'panel.trigger': 'Vault',
  'panel.title': '知识库 Vault',
  'panel.upload.label': '上传 .docx / .pdf / .md / .txt',
  'panel.upload.button': '上传并转换',
  'panel.upload.uploading': '正在上传…',
  'panel.upload.done': '已保存 {name}',
  'panel.upload.failed': '上传失败：{message}',
  'panel.notes.empty': '还没有笔记，先上传一个文件吧。',
  'panel.notes.count': '{count} 条笔记',
  'panel.notes.links': '{count} 个链接',
  'panel.loadFailed': '读取 vault 失败：{message}',
  'panel.graph.title': '关系图',
} satisfies Record<string, string>

export type VaultKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    vault: VaultKey
  }
}

/** English vault panel dictionary, checked complete against the zh key set. */
export const en = {
  'panel.trigger': 'Vault',
  'panel.title': 'Knowledge vault',
  'panel.upload.label': 'Upload .docx / .pdf / .md / .txt',
  'panel.upload.button': 'Upload & convert',
  'panel.upload.uploading': 'Uploading…',
  'panel.upload.done': 'Saved {name}',
  'panel.upload.failed': 'Upload failed: {message}',
  'panel.notes.empty': 'No notes yet — upload a file to get started.',
  'panel.notes.count': '{count} notes',
  'panel.notes.links': '{count} links',
  'panel.loadFailed': 'Failed to load the vault: {message}',
  'panel.graph.title': 'Link graph',
} satisfies Record<VaultKey, string>

/** Vietnamese vault panel dictionary, checked complete against the zh key set. */
export const vi = {
  'panel.trigger': 'Vault',
  'panel.title': 'Vault kiến thức',
  'panel.upload.label': 'Tải lên .docx / .pdf / .md / .txt',
  'panel.upload.button': 'Tải lên & convert',
  'panel.upload.uploading': 'Đang tải lên…',
  'panel.upload.done': 'Đã lưu {name}',
  'panel.upload.failed': 'Tải lên thất bại: {message}',
  'panel.notes.empty': 'Chưa có ghi chú nào — tải lên 1 file để bắt đầu.',
  'panel.notes.count': '{count} ghi chú',
  'panel.notes.links': '{count} liên kết',
  'panel.loadFailed': 'Tải vault thất bại: {message}',
  'panel.graph.title': 'Sơ đồ liên kết',
} satisfies Record<VaultKey, string>

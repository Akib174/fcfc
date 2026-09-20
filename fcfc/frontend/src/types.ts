export interface User {
  id: string
  username: string
  about?: string
  avatarKey?: string
  lastSeenAt?: number
  lastSeenPriv?: string
  privacyDm?: string
  deleted?: boolean
}

export type MsgType =
  | 'text' | 'image' | 'video' | 'voice' | 'file' | 'sticker' | 'gif'
  | 'system' | 'sender-key' | 'call'

export interface MediaMeta {
  key: string
  name?: string
  size?: number
  mime?: string
  iv?: string         // base64url file-encryption IV
  fileKey?: string    // base64url AES-GCM key (শুধু এনক্রিপ্টেড মেসেজ-পেলোডে থাকে)
  w?: number
  h?: number
  dur?: number
}

export interface ReactionMap { [emoji: string]: string[] }

export interface Message {
  id: string
  chatId: string
  senderId: string
  ts: number
  type: MsgType
  body?: string            // ডিক্রিপ্টেড টেক্সট
  payload?: any            // raw এনক্রিপ্টেড পেলোড (wire format)
  media?: MediaMeta
  replyTo?: { id: string; body: string; senderId: string }
  fwdFrom?: string
  editedAt?: number
  expiresAt?: number
  reactions: ReactionMap
  pending?: boolean
  failed?: boolean
  starred?: boolean
  read?: boolean       // পিয়ার পড়েছে (রিসিট)
  delivered?: boolean  // পিয়ারের ডিভাইসে পৌঁছেছে
}

export interface ChatMember { id: string; username: string; about?: string; avatarKey?: string; role: string; deleted?: boolean }

export interface Chat {
  id: string
  kind: 'dm' | 'group'
  title?: string
  photoKey?: string
  description?: string
  memberLimit?: number
  members: ChatMember[]
  // পার-ইউজার স্টেট
  pinned?: boolean
  archived?: boolean
  mutedUntil?: number
  wallpaper?: string
  ttl?: number
  unread: number
  lastTs?: number
  lastPreview?: string
  typing?: string[]
  pins?: string[]
  activeCall?: any
  peer?: User            // dm-এর জন্য
}

export interface DeviceInfo { id: string; name: string; approved: number; created_at: number; last_active: number }

export interface SendDraft {
  type: MsgType
  body?: string
  media?: MediaMeta
  replyTo?: Message['replyTo']
  ttl?: number
  fwdFrom?: string
}

export type Theme = 'light' | 'dark'

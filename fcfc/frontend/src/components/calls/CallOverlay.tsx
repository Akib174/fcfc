// ভয়েস/ভিডিও কল — Cloudflare Calls (SFU) + WebRTC।
// ট্র্যাক-নামে নিজের ইউজারআইডি থাকে বলে গ্রুপ কলে পার্টিসিপ্যান্ট চেনা যায়;
// চলমান কলে যেকোনো সময় জয়েন করা যায় (উপরের সেন্টারে নাম দেখায়)।
import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUi } from '../../stores/ui'
import { useAuth } from '../../stores/auth'
import { useChats } from '../../stores/chats'
import { api } from '../../api/client'
import { sendChat } from '../../realtime/sockets'
import { Avatar } from '../common'
import { chatTitle } from '../../lib/notify'
import { IcMic, IcMicOff, IcVideo, IcVideoOff, IcScreen, IcPhoneEnd } from '../../lib/icons'

export default function CallOverlay() {
  const call = useUi((s) => s.call)
  const setCall = useUi((s) => s.setCall)
  const toast = useUi((s) => s.toast)
  const me = useAuth.getState().user!

  const [participants, setParticipants] = useState<string[]>([])
  const [muted, setMuted] = useState(false)
  const [camOff, setCamOff] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const localVidRef = useRef<HTMLVideoElement>(null)
  const remoteRefs = useRef<Record<string, HTMLVideoElement | null>>({})
  const callInfo = useRef<{ sessionId: string; location: string } | null>(null)

  const chat = call ? useChats.getState().chats[call.chatId] : null

  useEffect(() => {
    if (!call) return
    let dead = false
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000)
    setParticipants([me.username])

    ;(async () => {
      try {
        const existing = useChats.getState().chats[call.chatId]?.activeCall
        let info = existing ? { sessionId: existing.sessionId, location: existing.location } : null
        if (!info) {
          const r = await api('/calls/session', { body: { chatId: call.chatId } })
          if (!r.sessionId) throw new Error('Calls সেশন তৈরি হয়নি (টোকেন সেটআপ দেখুন)')
          info = { sessionId: r.sessionId, location: r.location }
          sendChat(call.chatId, { t: 'call', chatId: call.chatId, action: 'start', call: info })
        } else {
          sendChat(call.chatId, { t: 'call', chatId: call.chatId, action: 'join', participants: [me.id] })
        }
        if (dead) return
        callInfo.current = info

        // মিডিয়া
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: call.mode === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
        })
        if (dead) { stream.getTracks().forEach((t) => t.stop()); return }
        localStreamRef.current = stream
        if (localVidRef.current && call.mode === 'video') localVidRef.current.srcObject = stream

        // পিয়ার কানেকশন → SFU
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] })
        pcRef.current = pc
        const tracksMeta: any[] = []
        for (const track of stream.getTracks()) {
          const sender = pc.addTrack(track, stream)
          // `mid` থাকে ট্রান্সিভারে, সেন্ডারে নয় — নইলে undefined যেত
          const mid = pc.getTransceivers().find((t) => t.sender === sender)?.mid
          tracksMeta.push({ location: 'local', mid: mid || undefined, trackName: `${me.id}:${track.kind}` })
        }
        pc.ontrack = (e) => {
          const stream2 = e.streams[0]
          const name = (e.transceiver as any)?.mid || ''
          // SFU থেকে আসা রিমোট ট্র্যাক — টাইল তৈরি হয় রেন্ডারে
          const key = 'remote-' + (stream2.id || name)
          setParticipants((p) => p.includes(key) ? p : [...p, key])
          setTimeout(() => { const el = remoteRefs.current[key]; if (el) el.srcObject = stream2 }, 50)
        }
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        const res = await api('/calls/negotiate', {
          body: { sessionId: info.sessionId, location: info.location, body: { sessionDescription: offer, tracks: tracksMeta } },
        })
        if (dead) return
        if (res.sessionDescription) await pc.setRemoteDescription(res.sessionDescription)
        // এসেছে এমন মিডিয়া-নেম থেকে পার্টিসিপ্যান্ট চেনা
        for (const t of res.tracks || []) {
          if (t.trackName && t.location === 'remote') {
            const uid = String(t.trackName).split(':')[0]
            if (uid && uid !== me.id) {
              const member = useChats.getState().chats[call.chatId]?.members.find((m) => m.id === uid)
              setParticipants((p) => p.includes(member?.username || uid) ? p : [...p, member?.username || uid])
            }
          }
        }
      } catch (e: any) {
        console.error(e)
        setError(e.message || 'কল শুরু করা যায়নি')
      }
    })()

    return () => {
      dead = true
      clearInterval(timer)
      teardown()
      if (callInfo.current) sendChat(call.chatId, { t: 'call', chatId: call.chatId, action: 'end', call: null })
      callInfo.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call?.chatId, call?.mode])

  function teardown() {
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    pcRef.current?.close()
    pcRef.current = null
    localStreamRef.current = null
  }

  async function toggleShare() {
    const pc = pcRef.current
    if (!pc) return
    try {
      if (!sharing) {
        const ds = await navigator.mediaDevices.getDisplayMedia({ video: true })
        const screenTrack = ds.getVideoTracks()[0]
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
        if (sender) await sender.replaceTrack(screenTrack)
        screenTrack.onended = () => { sender?.replaceTrack(localStreamRef.current?.getVideoTracks()[0] || null); setSharing(false) }
        setSharing(true)
      } else {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
        const cam = localStreamRef.current?.getVideoTracks()[0] || null
        if (sender && cam) await sender.replaceTrack(cam)
        setSharing(false)
      }
    } catch {}
  }

  if (!call) return null
  const title = chat ? chatTitle(chat) : 'কল'
  const dur = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[75] bg-[#0b0f1a]/97 backdrop-blur flex flex-col">
      {/* উপরের সেন্টারে পার্টিসিপ্যান্ট (টেলিগ্রাম-স্টাইল) */}
      <div className="pt-5 flex flex-col items-center gap-1.5">
        <div className="text-white font-semibold text-lg">{title}</div>
        <div className="text-white/50 text-sm">{error ? error : dur}</div>
        <div className="flex items-center gap-1.5 flex-wrap justify-center max-w-md px-4">
          {participants.map((p, i) => (
            <motion.span key={i} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
              className="px-3 py-1 rounded-full bg-white/10 text-white/85 text-xs font-medium flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />{p.replace('remote-', 'অতিথি ')}
            </motion.span>
          ))}
        </div>
      </div>

      {/* ভিডিও গ্রিড */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(participants.length, 2)}, minmax(0, 1fr))` }}>
          {call.mode === 'video' ? (
            <>
              {participants.map((p, i) => (
                <div key={i} className="relative w-[300px] h-[200px] md:w-[420px] md:h-[280px] rounded-2xl overflow-hidden bg-slate-800">
                  {i === 0 ? (
                    <video ref={localVidRef} muted playsInline className="w-full h-full object-cover" />
                  ) : (
                    <RemoteTile id={p} refs={remoteRefs} />
                  )}
                  <span className="absolute bottom-2 left-2.5 px-2 py-0.5 rounded-md bg-black/50 text-white text-xs">{i === 0 ? 'আপনি' : p}</span>
                </div>
              ))}
            </>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 2 }}
                className="w-28 h-28 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-4xl font-bold shadow-2xl shadow-brand-500/40">
                {title.slice(0, 1).toUpperCase()}
              </motion.div>
              <div className="text-white/70 text-sm">🔊 ভয়েস কল — এন্ড-টু-এন্ড এনক্রিপ্টেড মিডিয়া</div>
            </div>
          )}
        </div>
      </div>

      {/* কন্ট্রোল */}
      <div className="pb-8 flex items-center justify-center gap-4">
        <CallBtn on={!muted} onClick={() => { const t = localStreamRef.current?.getAudioTracks()[0]; if (t) { t.enabled = muted; setMuted(!muted) } }}>
          {muted ? <IcMicOff size={22} /> : <IcMic size={22} />}
        </CallBtn>
        {call.mode === 'video' && (
          <CallBtn on={!camOff} onClick={() => { const t = localStreamRef.current?.getVideoTracks()[0]; if (t) { t.enabled = camOff; setCamOff(!camOff) } }}>
            {camOff ? <IcVideoOff size={22} /> : <IcVideo size={22} />}
          </CallBtn>
        )}
        <CallBtn on={!sharing} onClick={toggleShare}><IcScreen size={22} /></CallBtn>
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => { teardown(); setCall(null) }}
          className="w-14 h-14 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-lg shadow-rose-500/40">
          <IcPhoneEnd size={24} />
        </motion.button>
      </div>
    </motion.div>
  )
}

function RemoteTile({ id, refs }: { id: string; refs: any }) {
  return <video ref={(el) => { refs.current[id] = el }} autoPlay playsInline className="w-full h-full object-cover bg-black" />
}

function CallBtn({ children, onClick, on }: { children: React.ReactNode; onClick: () => void; on: boolean }) {
  return (
    <motion.button whileTap={{ scale: 0.9 }} onClick={onClick}
      className={`w-12 h-12 rounded-full flex items-center justify-center transition ${on ? 'bg-white/10 text-white' : 'bg-white text-slate-900'}`}>
      {children}
    </motion.button>
  )
}

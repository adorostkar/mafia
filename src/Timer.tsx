import { useEffect, useRef, useState } from "react";
import type { Timer as GameTimer } from "../shared/game";
import type { Translation } from "./i18n";

export function Timer({
  timer,
  serverNow,
  t,
}: {
  timer: GameTimer;
  serverNow: number;
  t: Translation;
}) {
  const [now, setNow] = useState(serverNow);
  const [sound, setSound] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const sounded = useRef<number | null>(null);
  const remaining = timer
    ? Math.max(0, Math.ceil((timer.endsAt - now) / 1000))
    : 0;
  const total = timer?.kind === "speaking" ? 60 : 30;
  useEffect(() => {
    const receivedAt = performance.now();
    const tick = setInterval(
      () => setNow(serverNow + performance.now() - receivedAt),
      250,
    );
    return () => clearInterval(tick);
  }, [serverNow]);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  useEffect(() => {
    if (!timer || remaining !== 0 || sounded.current === timer.endsAt) return;
    sounded.current = timer.endsAt;
    if (sound && audio.current?.state === "running") {
      const oscillator = audio.current.createOscillator();
      const gain = audio.current.createGain();
      oscillator.connect(gain);
      gain.connect(audio.current.destination);
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0.15, audio.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        audio.current.currentTime + 0.7,
      );
      oscillator.start();
      oscillator.stop(audio.current.currentTime + 0.7);
    }
  }, [remaining, sound, timer]);
  async function toggleSound() {
    if (sound) {
      setSound(false);
      return;
    }
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      setSound(true);
      setAudioError(false);
    } catch (error) {
      console.error("Could not enable timer audio", error);
      setAudioError(true);
    }
  }
  const announcement = !timer
    ? t.text.timerIdle
    : remaining === 0
      ? t.text.timeUp
      : remaining <= 10
        ? t.message("timerRemaining", { timer: t.text[timer.kind], count: 10 })
        : t.message("timerStart", { timer: t.text[timer.kind], count: total });
  return (
    <div className="timer">
      <div>
        <p className="eyebrow">{timer ? t.text[timer.kind] : t.text.timers}</p>
        <div
          className="clock"
          role="timer"
          aria-label={
            timer
              ? t.message("timerRemaining", {
                  timer: t.text[timer.kind],
                  count: remaining,
                })
              : t.text.timerIdle
          }
          aria-live="off"
        >
          {timer
            ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
            : "—:—"}
        </div>
        <p className={timer && remaining === 0 ? "time-up" : "muted"}>
          {timer && remaining === 0 ? t.text.timeUp : t.text.seconds}
        </p>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={sound}
          onChange={() => void toggleSound()}
        />
        {t.text.sound}
      </label>
      {audioError && <p role="alert">{t.text.soundUnavailable}</p>}
      <p className="sr-only" role="status" aria-atomic="true">
        {announcement}
      </p>
    </div>
  );
}

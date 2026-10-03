"""Speech to text for merchants' voice notes (Part G).

Anthropic's API does not accept audio at all, so this cannot go through the AI orchestrator the way
every other model call does. It runs locally instead, with faster-whisper: no key, no per-minute
cost, nothing leaves the machine, and Whisper handles Urdu, Roman Urdu and English, which is exactly
the mix a shopkeeper here speaks.

The model is loaded once and kept, because loading it is far slower than transcribing with it. Like
the embedder, it sits behind a small interface so a test can substitute a fake and so a different
engine could replace it without touching anything else.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Protocol

log = logging.getLogger(__name__)

#: Audio longer than this is refused. A spoken instruction to a shop is seconds, not minutes, and a
#: long file would tie up the one worker this service has.
MAX_AUDIO_SECONDS = 120
#: Bigger than any plausible voice note, and a cheap guard against a huge upload.
MAX_AUDIO_BYTES = 10 * 1024 * 1024


@dataclass(frozen=True)
class Transcript:
    text: str
    #: The language Whisper detected ("ur", "en", ...), or None when it could not tell.
    language: str | None
    #: Rough confidence, 0 to 1. Low means the merchant should read the words before confirming.
    confidence: float
    duration_seconds: float


class Transcriber(Protocol):
    async def transcribe(self, audio: bytes, filename: str) -> Transcript: ...


class FasterWhisperTranscriber:
    """Local Whisper. `model_size` of "small" is the useful floor for Urdu; "base" is faster but
    makes more mistakes on it, and the merchant has to read the draft anyway."""

    def __init__(self, model_size: str = "small", cache_dir: str | None = None, compute_type: str = "int8") -> None:
        self._model_size = model_size
        self._cache_dir = cache_dir
        self._compute_type = compute_type
        self._model = None

    def _load(self):
        if self._model is None:
            from faster_whisper import WhisperModel  # imported late: a heavy import, and only this path needs it

            log.info("loading whisper model %s", self._model_size)
            self._model = WhisperModel(self._model_size, device="cpu", compute_type=self._compute_type, download_root=self._cache_dir)
        return self._model

    def _run(self, path: str) -> Transcript:
        model = self._load()
        # vad_filter drops silence, which is most of a phone recording and the slowest thing to decode.
        segments, info = model.transcribe(path, vad_filter=True, beam_size=1)
        pieces: list[str] = []
        probs: list[float] = []
        for seg in segments:
            pieces.append(seg.text)
            # avg_logprob is a log probability; exp turns it into something readable as a confidence.
            probs.append(min(1.0, max(0.0, 2.718281828 ** seg.avg_logprob)))
        text = " ".join(p.strip() for p in pieces).strip()
        confidence = sum(probs) / len(probs) if probs else 0.0
        return Transcript(
            text=text,
            language=getattr(info, "language", None),
            confidence=round(confidence, 3),
            duration_seconds=round(getattr(info, "duration", 0.0), 2),
        )

    async def transcribe(self, audio: bytes, filename: str) -> Transcript:
        import tempfile
        import os

        suffix = os.path.splitext(filename)[1] or ".webm"
        # Whisper reads a file, so the upload is written to a temporary one and removed straight after.
        fd, path = tempfile.mkstemp(suffix=suffix)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(audio)
            return await asyncio.to_thread(self._run, path)
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass


class UnavailableTranscriber:
    """Stands in when faster-whisper is not installed, so the rest of the service still starts.
    Asking it to transcribe says plainly that the feature is off rather than failing obscurely."""

    async def transcribe(self, audio: bytes, filename: str) -> Transcript:
        raise RuntimeError("Speech to text is not installed on this server (pip install faster-whisper)")


def build_transcriber(enabled: bool, model_size: str, cache_dir: str | None) -> Transcriber:
    if not enabled:
        return UnavailableTranscriber()
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        log.warning("faster-whisper is not installed; voice notes will be refused")
        return UnavailableTranscriber()
    return FasterWhisperTranscriber(model_size, cache_dir)

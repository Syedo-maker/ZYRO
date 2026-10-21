# ZYRO recommendation service: product embeddings, semantic search, and speech to text for voice notes.
#
# The models are downloaded while the image is built, not when a container starts. A container that
# fetched them at start (as the service did before) downloaded them again on every restart and
# scale-out, started slowly, and could not start at all while Hugging Face was unreachable. Here they
# are part of the image, and the service runs with Hugging Face switched off (HF_HUB_OFFLINE=1).
# PIP_DEFAULT_TIMEOUT and PIP_RETRIES are there because a build that downloads hundreds of megabytes
# should survive a flaky connection rather than fail on the first dropped read.

FROM python:3.11-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=10
WORKDIR /app

FROM base AS deps
COPY requirements.txt .
RUN pip install --prefix=/install -r requirements.txt

FROM base AS models
COPY --from=deps /install /usr/local
# The same model names the service reads from RECO_MODEL and WHISPER_MODEL at run time. Building with
# --build-arg WITH_WHISPER=false makes a smaller image that refuses voice notes.
ARG RECO_MODEL=BAAI/bge-small-en-v1.5
ARG WHISPER_MODEL=small
ARG WITH_WHISPER=true
RUN python -c "from fastembed import TextEmbedding; TextEmbedding(model_name='${RECO_MODEL}', cache_dir='/models')" \
 && if [ "$WITH_WHISPER" = "true" ]; then \
      python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8', download_root='/models')"; \
    fi

FROM base AS runtime
COPY --from=deps /install /usr/local
COPY --from=models /models /models
COPY app ./app
ARG RECO_MODEL=BAAI/bge-small-en-v1.5
ARG WHISPER_MODEL=small
ARG WITH_WHISPER=true
ENV RECO_MODEL=${RECO_MODEL} \
    RECO_MODEL_CACHE=/models \
    WHISPER_MODEL=${WHISPER_MODEL} \
    WHISPER_ENABLED=${WITH_WHISPER} \
    HF_HUB_OFFLINE=1 \
    PORT=8001
RUN useradd --system --uid 10001 --no-create-home zyro && chown -R zyro /models
USER zyro
EXPOSE 8001
# One process per container: Container Apps adds replicas for more throughput. uvicorn finishes the
# requests in flight on SIGTERM before it exits.
CMD ["sh", "-c", "exec uvicorn app.asgi:app --host 0.0.0.0 --port ${PORT} --timeout-graceful-shutdown 20"]

FROM python:3.12.16-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_NO_CACHE=1 \
    HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 DO_NOT_TRACK=1 \
    PATH=/app/research/acephale/training/.venv/bin:$PATH
RUN python -m pip install --no-cache-dir uv==0.13.0
WORKDIR /app/research/acephale/training
COPY research/acephale/pyproject.toml ../pyproject.toml
COPY research/acephale/src ../src
COPY research/acephale/training/pyproject.toml research/acephale/training/uv.lock ./
COPY src/lib/acephale/contracts /app/src/lib/acephale/contracts
RUN uv sync --frozen --no-dev --python /usr/local/bin/python
RUN useradd --uid 10001 --create-home trainer
USER 10001
ENTRYPOINT ["python", "-m", "acephale.training_cli"]

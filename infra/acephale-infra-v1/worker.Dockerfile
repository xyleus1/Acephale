ARG PYTHON_IMAGE
FROM ${PYTHON_IMAGE}
WORKDIR /app/research/acephale
COPY research/acephale/pyproject.toml research/acephale/uv.lock ./
COPY research/acephale/src ./src
COPY research/acephale/scripts ./scripts
COPY src/lib/acephale/contracts /app/src/lib/acephale/contracts
RUN pip install --no-cache-dir 'uv==0.9.7' && uv sync --frozen --extra analysis --no-dev
ENV PATH="/app/research/acephale/.venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1
RUN useradd --uid 10001 --create-home worker
USER worker
ENTRYPOINT ["python", "-m", "acephale.infra_cli"]
CMD ["--help"]

ARG PYTHON_IMAGE
FROM ${PYTHON_IMAGE}
WORKDIR /app
COPY research/goalspec/pyproject.toml research/goalspec/uv.lock ./
COPY research/goalspec/src ./src
COPY research/goalspec/scripts ./scripts
RUN pip install --no-cache-dir 'uv==0.9.7' && uv sync --frozen --extra analysis --no-dev
ENV PATH="/app/.venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1
RUN useradd --uid 10001 --create-home worker
USER worker
ENTRYPOINT ["python", "-m", "goalspec.infra_cli"]
CMD ["--help"]

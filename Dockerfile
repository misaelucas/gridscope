FROM node:22-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
COPY src/grid_report/static /app/src/grid_report/static
RUN npm run build

FROM python:3.11-slim AS runtime
WORKDIR /app
COPY pyproject.toml requirements.lock.txt ./
COPY src src
COPY --from=frontend /app/frontend/dist src/grid_report/static/spa
RUN pip install --no-cache-dir -r requirements.lock.txt && pip install --no-cache-dir --no-deps .
RUN useradd --create-home app && mkdir -p /app/data /app/.dagster && chown -R app:app /app
USER app
ENV DAGSTER_HOME=/app/.dagster
EXPOSE 8000
CMD ["uvicorn", "grid_report.api:app", "--host", "0.0.0.0", "--port", "8000"]

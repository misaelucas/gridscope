FROM python:3.11-slim
WORKDIR /app
COPY pyproject.toml requirements.lock.txt ./
COPY src src
RUN pip install --no-cache-dir -r requirements.lock.txt && pip install --no-cache-dir --no-deps .
RUN useradd --create-home app && mkdir -p /app/data /app/.dagster && chown -R app:app /app
USER app
ENV DAGSTER_HOME=/app/.dagster
EXPOSE 8000
CMD ["uvicorn", "grid_report.api:app", "--host", "0.0.0.0", "--port", "8000"]

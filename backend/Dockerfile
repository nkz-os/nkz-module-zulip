FROM python:3.11-slim
LABEL org.opencontainers.image.source=https://github.com/nkz-os/nkz-module-zulip

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONPATH=/app
EXPOSE 5000

CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:5000", "--timeout", "120", "app:create_app()"]

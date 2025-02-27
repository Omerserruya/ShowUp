# Dockerfile for app.py
FROM python:3.12

WORKDIR /app

COPY app/ .
RUN pip install -r /app/requirements.txt

EXPOSE 3000
CMD ["python", "app.py"]

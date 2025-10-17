import os
import time
import json
import logging
import threading
from logging.config import dictConfig

from fastapi import FastAPI
import uvicorn

from db import connect as db_connect, fetch_and_mark_due, revert_to_pending
from mq import connect as mq_connect, publish_campaign


def configure_logging():
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    handler = logging.StreamHandler()
    formatter = logging.Formatter(
        fmt='level=%(levelname)s ts=%(asctime)s logger=%(name)s msg="%(message)s"',
        datefmt='%Y-%m-%dT%H:%M:%SZ'
    )
    handler.setFormatter(formatter)
    root.addHandler(handler)


def log_json(logger: logging.Logger, level: int, message: str, **fields):
    if fields:
        message = f"{message} | data={json.dumps(fields, default=str)}"
    logger.log(level, message)


def run_loop():
    configure_logging()
    logger = logging.getLogger("scheduler")
    check_interval = int(os.getenv("CHECK_INTERVAL", "30"))
    queue_name = os.getenv("CAMPAIGNS_QUEUE", "campaigns")

    log_json(logger, logging.INFO, "Scheduler started", interval=check_interval, queue=queue_name)
    conn = db_connect()
    rabbit = mq_connect()
    channel = rabbit.channel()

    try:
        while True:
            rows = fetch_and_mark_due(conn)
            log_json(logger, logging.INFO, "Cycle fetched", count=len(rows))
            for row in rows:
                msg = {
                    "campaign_id": str(row["id"]),
                    "event_id": str(row["event_id"]),
                    "payload": {
                        "name": row["name"],
                        "template": row["template"],
                        "channel": row["channel"],
                        "schedule_time": row["schedule_time"].isoformat() if row["schedule_time"] else None,
                    },
                }
                try:
                    # If channel got closed, reopen
                    if channel.is_closed:
                        channel = rabbit.channel()
                    publish_campaign(channel, queue_name, msg)
                    log_json(logger, logging.INFO, "Published", campaign_id=msg["campaign_id"])
                except Exception as e:
                    log_json(logger, logging.ERROR, "Publish failed; reverting to pending", campaign_id=row["id"], error=str(e))
                    try:
                        revert_to_pending(conn, str(row["id"]))
                    except Exception:
                        pass

            time.sleep(check_interval)
    finally:
        try:
            channel.close()
            rabbit.close()
        except Exception:
            pass
        try:
            conn.close()
        except Exception:
            pass


app = FastAPI()


@app.get("/healthz")
def health():
    return {"status": "ok"}


def main():
    # Start loop in a thread, expose health via uvicorn
    t = threading.Thread(target=run_loop, daemon=True)
    t.start()
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "5008")))


if __name__ == "__main__":
    main()



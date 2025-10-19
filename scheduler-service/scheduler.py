import os
import time
import json
import logging
import threading
from logging.config import dictConfig

from fastapi import FastAPI
import uvicorn

from db import connect as db_connect, fetch_and_mark_due, revert_to_pending
from mq import connect as mq_connect, publish_campaign, is_connection_healthy, reconnect_rabbitmq, send_heartbeat


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
    rabbit, channel = reconnect_rabbitmq()
    
    # Heartbeat interval (every 30 seconds to stay well under 60s heartbeat timeout)
    heartbeat_interval = 30
    last_heartbeat = time.time()

    try:
        while True:
            current_time = time.time()
            
            # Send heartbeat if needed
            if current_time - last_heartbeat >= heartbeat_interval:
                if send_heartbeat(rabbit):
                    last_heartbeat = current_time
                else:
                    log_json(logger, logging.WARNING, "Heartbeat failed, reconnecting...")
                    rabbit, channel = reconnect_rabbitmq()
                    last_heartbeat = current_time
            
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
                    # Check connection health and reconnect if needed
                    if not is_connection_healthy(rabbit) or channel.is_closed:
                        log_json(logger, logging.WARNING, "RabbitMQ connection unhealthy, reconnecting...")
                        rabbit, channel = reconnect_rabbitmq()
                        last_heartbeat = current_time
                    
                    publish_campaign(channel, queue_name, msg)
                    log_json(logger, logging.INFO, "Published", campaign_id=msg["campaign_id"])
                    
                except Exception as e:
                    log_json(logger, logging.ERROR, "Publish failed; reverting to pending", campaign_id=row["id"], error=str(e))
                    try:
                        revert_to_pending(conn, str(row["id"]))
                    except Exception as revert_error:
                        log_json(logger, logging.ERROR, "Failed to revert campaign to pending", campaign_id=row["id"], error=str(revert_error))
                    
                    # Try to reconnect after publish failure
                    try:
                        rabbit, channel = reconnect_rabbitmq()
                        last_heartbeat = current_time
                        log_json(logger, logging.INFO, "Reconnected to RabbitMQ after failure")
                    except Exception as reconnect_error:
                        log_json(logger, logging.ERROR, "Failed to reconnect to RabbitMQ", error=str(reconnect_error))

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



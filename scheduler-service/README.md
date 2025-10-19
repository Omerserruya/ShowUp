
Background worker service that periodically scans for scheduled campaigns, enqueues them for delivery, and handles errors with exponential backoff. Provides reliable campaign scheduling with RabbitMQ integration and PostgreSQL persistence.
### Environment Variables

- **Database (Postgres)**
	- `DB_HOST` - Database host (required)
	- `DB_PORT` - Database port (required)
	- `DB_USER` - Database username (required)
	- `DB_PASSWORD` - Database password (required)
	- `DB_NAME` - Database name (required)
- **RabbitMQ**
	- `RABBITMQ_HOST` - RabbitMQ host (default: rabbitmq)
	- `RABBITMQ_PORT` - RabbitMQ port (default: 5672)
	- `RABBITMQ_USER` - RabbitMQ username (default: guest)
	- `RABBITMQ_PASSWORD` - RabbitMQ password (default: guest)
	- `RABBITMQ_HEARTBEAT` - Heartbeat interval in seconds (default: 60)
	- `RABBITMQ_BLOCKED_TIMEOUT` - Blocked connection timeout in seconds (default: 300)
	- `RABBITMQ_SOCKET_TIMEOUT` - Socket timeout in seconds (default: 5)
- **Service Configuration**
	- `PORT` - Service port for health checks (default: 5008)
	- `CHECK_INTERVAL` - Campaign check interval in seconds (default: 30)
	- `CAMPAIGNS_QUEUE` - RabbitMQ queue name for campaigns (default: campaigns)

### Architecture

The scheduler service operates as a background worker with the following components:
1. **Main Loop**: Runs every `CHECK_INTERVAL` seconds
2. **Database Scanner**: Atomically fetches and marks due campaigns as "processing"
3. **Message Publisher**: Publishes campaigns to RabbitMQ queue
4. **Error Handler**: Reverts failed campaigns back to "pending" status
5. **Connection Manager**: Maintains stable RabbitMQ connections with heartbeat
### How It Works
#### 1. Campaign Discovery

```sql
UPDATE campaigns
SET status = 'processing'
WHERE id IN (
SELECT id FROM campaigns
WHERE status = 'pending'
AND schedule_time IS NOT NULL
AND schedule_time <= NOW()
FOR UPDATE SKIP LOCKED
)
RETURNING id, event_id, name, template, channel, schedule_time, status
```

#### 2. Message Publishing
Publishes to RabbitMQ queue with structure:
```json
{
	"campaign_id": "uuid",
	"event_id": "uuid",
	"payload": {
		"name": "Campaign Name",
		"template": "Message template",
		"channel": "whatsapp",
		"schedule_time": "2024-06-15T10:00:00Z"
	}
}

```

#### 3. Error Handling
- **Publish Failure**: Reverts campaign status to "pending"
- **Connection Failure**: Reconnects with exponential backoff
- **Heartbeat Failure**: Proactively reconnects before timeout
### Features
#### **Reliable Scheduling**
- Atomic campaign claiming using `FOR UPDATE SKIP LOCKED`
- Prevents duplicate processing in multi-instance deployments
- Graceful error handling with status reversion
#### **Connection Management**
- **Heartbeat System**: Sends heartbeats every 30 seconds
- **Auto-Reconnection**: Reconnects on connection failures
- **Health Monitoring**: Proactive connection health checks
- **Exponential Backoff**: Smart retry logic for failed operations
#### **Error Recovery**
- **Campaign Reversion**: Failed campaigns return to "pending" status
- **Connection Recovery**: Automatic reconnection after failures
- **Retry Logic**: 3 attempts with exponential backoff for publishes
- **Graceful Degradation**: Continues operation despite individual failures
### API Endpoints
#### Health Check
- **GET** `/healthz`
- 200: `{ "status": "ok" }`
- Used for container health monitoring
### Message Queue Integration
#### **RabbitMQ Queue Structure**
- **Queue Name**: Configurable via `CAMPAIGNS_QUEUE` (default: "campaigns")
- **Durability**: Queue is marked as durable
- **Message Persistence**: Messages are marked as persistent (delivery_mode=2)
- **Routing**: Direct routing to queue (no exchange)
#### **Message Format**
```json
{
"campaign_id": "e5703106-07c6-4fc8-ba56-5c2db5de6210",
"event_id": "123e4567-e89b-12d3-a456-426614174000",
"payload": {
"name": "Wedding Reminder",
"template": "Hi {{name}}, don't forget about our wedding!",
"channel": "whatsapp",
"schedule_time": "2024-06-15T10:00:00Z"
}
}
```
### Deployment 
#### **Docker**
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE ${PORT}
CMD ["python", "scheduler.py"]
```

### Monitoring & Logging
#### **Structured Logging**
- **Format**: `level=INFO ts=2025-10-19T11:07:20Z logger=scheduler msg="message" data={...}`
- **Log Levels**: INFO, WARNING, ERROR
- **Key Events**: Cycle fetched, Published, Reconnected, Heartbeat failed
#### **Key Metrics to Monitor**
- **Cycle Frequency**: How often campaigns are checked
- **Campaign Count**: Number of campaigns processed per cycle
- **Publish Success Rate**: Percentage of successful publishes
- **Connection Health**: RabbitMQ connection stability
- **Error Rate**: Failed publishes and reconnections
#### **Health Indicators**
- **Healthy**: Regular "Cycle fetched" logs with consistent intervals
- **Issues**: "Publish failed" or "Heartbeat failed" errors
- **Critical**: No logs for extended periods (service down)
### Configuration Examples
#### **High-Frequency Processing**
```bash
CHECK_INTERVAL=10 # Check every 10 seconds
RABBITMQ_HEARTBEAT=30 # 30s heartbeat
```
#### **Low-Resource Environment**
```bash
CHECK_INTERVAL=60 # Check every minute
RABBITMQ_HEARTBEAT=120 # 2 minute heartbeat
```
Volume Production**
```bash
CHECK_INTERVAL=15 # Check every 15 seconds
RABBITMQ_HEARTBEAT=60 # 1 minute heartbeat
RABBITMQ_BLOCKED_TIMEOUT=600 # 10 minute blocked timeout
```

  
Event management microservice for managing Events, Guests, and Campaigns. Provides CRUD operations with ownership validation, pagination, bulk operations, and JWT-based authentication.

### Environment Variables
- **Database (Postgres)**
	- `DB_HOST` - Database host (default: required)
	- `DB_PORT` - Database port (default: required)
	- `DB_USER` - Database username (default: required)
	- `DB_PASSWORD` - Database password (default: required)
	- `DB_NAME` - Database name (default: required)
	- `DATABASE_URL` - Alternative: full database URL (overrides individual DB_* vars)
- **Authentication**
	- `JWT_SECRET` - HMAC secret for JWT validation (default: required)
	- `JWT_EXP_SECONDS` - JWT expiration time in seconds (default: required)
- **Service**
	- `SERVICE_PORT` - Port to run the service on (default: 8000)
	- `CAMPAIGN_MIN_GAP_MINUTES` - Minimum minutes between campaign schedules (default: 300)

### Data Models

## Guests

| Field             | Descrive                                              | Type           |
| ----------------- | ----------------------------------------------------- | -------------- |
| **id**            | מזהה ייחודי לאורח                                     | `UUID`         |
| **event_id**      | שייך לאירוע                                           | `UUID`         |
| **name**          | שם האורח                                              | `VARCHAR(100)` |
| **phone**         | מספר טלפון                                            | `VARCHAR(20)`  |
| **email**         | אימייל (אופציונלי)                                    | `VARCHAR(100)` |
| **status**        | סטטוס הגעה (invited / attending / declined / unknown) | `VARCHAR(20)`  |
| **import_count**  | כמות צפויה מצד בעלי האירוע (העלאה/ייבוא)             | `INTEGER`      |
| **guest_count**   | כמות שאישר האורח בפועל (מתעדכן דרך WhatsApp)         | `INTEGER` (Nullable) |
| **table_number**  |                                                       | `INTEGER`      |
| **notes**         | הערות חופשיות כמו מנות וכו                            | `TEXT`         |
| **last_response** | זמן התגובה האחרונה                                    | `TIMESTAMP`    |
| **created_at**    | תאריך יצירה                                           | `TIMESTAMP`    |
## Events
| Field           | Descrive                    | Type                     |
| --------------- | --------------------------- | ------------------------ |
| **id**          | מזהה ייחודי לאירוע          | `UUID`                   |
| **owners**      | יוצר האירוע (FK ל־users.id) | `JSON or ARRAY of UUIDs` |
| **name**        | שם האירוע                   | `VARCHAR(100)`           |
| **description** | תיאור האירוע                | `TEXT`                   |
| **event_date**  | תאריך האירוע                | `TIMESTAMP`              |
| **location**    | מיקום האירוע                | `VARCHAR(200)`           |
| **created_at**  | תאריך יצירה                 | `TIMESTAMP`              |
| **updated_at**  | תאריך עדכון                 | `TIMESTAMP`              |
| **active**      |                             | `BOLEAN`                 |
## Campaigns 
| Field         | Descrive                                    | Type         |
| ------------- | ------------------------------------------- | ------------ |
| id            | מזהה ייחודי לקמפיין                         | UUID         |
| event_id      | לאיזה אירוע שייך הקמפיין                    | UUID         |
| name          | שם הקמפיין (למשל “Save the Date”)           | VARCHAR(100) |
| template      | תוכן הודעה / תבנית                          | TEXT         |
| channel       | ערוץ שליחה (whatsapp)                       | VARCHAR(20)  |
| schedule_time | מועד שליחה מתוכנן                           | TIMESTAMP    |
| status        | סטטוס (pending / scheduled / sent / failed) | VARCHAR(20)  |
| created_at    | תאריך יצירה                                 | TIMESTAMP    |
| updated_at    | תאריך עדכון                                 | TIMESTAMP    |

### Routes
#### Health Check
- **GET** `/healthz`
- 200: `{ "status": "ok" }`
#### Events
- **GET** `/events`
	- List events owned by current user
	- Query params: `page` (int, min 1), `page_size` (int, 1-200), `search` (string, optional)
	- Response: `EventOut[]`

- **GET** `/events/{event_id}`
	- Get specific event (must be owner)
	- Response: `EventOut` or 404

- **POST** `/events`
	- Create new event (automatically sets current user as owner)
	- Request body: `EventCreate`
```json
{
	"name": "Wedding Reception",
	"description": "John & Jane's wedding celebration",
	"event_date": "2024-06-15T18:00:00Z",
	"location": "Grand Ballroom, Hotel Plaza"
}
```
	- Response: `EventOut` (201)
  
- **PUT** `/events/{event_id}`
	- Update event (must be owner)
	- Request body: `EventUpdate`
	- Response: `EventOut` or 404

- **DELETE** `/events/{event_id}`
	- Delete event (must be owner)
	- Response: 204 or 404

#### Guests
- **GET** `/guests`
	- List guests for an event (must be event owner)
	- Query params: `event_id` (UUID, required), `page`, `page_size`, `search`
	- Response: `GuestOut[]`

- **GET** `/guests/{guest_id}`
	- Get specific guest
	- Response: `GuestOut` or 404

- **POST** `/guests`
	- Create guest(s) - supports single object or array
	- Query params: `event_id` (UUID, optional if in body)
	- Request body: `GuestCreate` or `GuestCreate[]` or `{ "items": GuestCreate[] }`
```json
{
	"name": "Alice Smith",
	"phone": "+1234567890",
	"email": "alice@example.com",
	"import_count": 2,
	"guest_count": null,
	"table_number": 5,
	"notes": "Vegetarian meal"
}
```
	- Response: `GuestOut` or `GuestOut[]` (201)

- **POST** `/guests?event_id=<event_id>`
	- Bulk import guests via CSV file or JSON array
```json
{
	"items":[{
				"name": "Alice Smith",
				"phone": "+1234567890",
				"email": "alice@example.com",
				"import_count": 2,
				"guest_count": null,
				"table_number": 5,
				"notes": "Vegetarian meal"
			},
			{
				"name": "Alice Smith",
				"phone": "+1234567890",
				"email": "alice@example.com",
				"import_count": 2,
				"guest_count": null,
				"table_number": 5,
				"notes": "Vegetarian meal"
		}...
	]
}
```
	- Query params: `event_id` (UUID, required)
	- Request: multipart form with CSV file OR JSON body with `GuestCreate[]`
	- Response: `GuestOut[]` (201)

- **PUT** `/guests/{guest_id}`
	- Update guest
	- Request body: `GuestUpdate`
	- Response: `GuestOut` or 404

- **DELETE** `/guests/{guest_id}`
	- Delete specific guest
	- Response: 204 or 404

- **DELETE** `/guests?event_id=<event_id>`
	- Delete all guests for an event (must be event owner)
	- Query params: `event_id` (UUID, required)
	- Response: `{ "deleted": int }`

#### Campaigns

- **GET** `/campaigns`
	- List campaigns for an event (must be event owner)
	- Query params: `event_id` (UUID, required), `page`, `page_size`, `search`
	- Response: `CampaignOut[]`

- **GET** `/campaigns/{campaign_id}`
	- Get specific campaign
	- Response: `CampaignOut` or 404

- **POST** `/campaigns`
	- Create campaign(s) - supports single object or array
	- Query params: `event_id` (UUID, optional if in body)
	- Request body: `CampaignCreate` or `CampaignCreate[]` or `{ "items": CampaignCreate[] }`
	- Response: `CampaignOut` or `CampaignOut[]` (201)

- **PUT** `/campaigns/{campaign_id}`
	- Update campaign
	- Request body: `CampaignUpdate`
	- Response: `CampaignOut` or 404

- **DELETE** `/campaigns/{campaign_id}`
	- Delete specific campaign
	- Response: 204 or 404

- **DELETE** `/campaigns?event_id=<event_id>`
	- Delete all campaigns for an event (must be event owner)
	- Query params: `event_id` (UUID, required)
	- Response: `{ "deleted": int }`

  




  

### Business Rules

- **Ownership**: Users can only access events they own (owners array contains their user_id)
- **Phone Uniqueness**: Phone numbers must be unique per event (can exist across different events)
- **Campaign Scheduling**: No two campaigns for the same event can have schedule_time within the configured minimum gap (default: 300 minutes/5 hours, configurable via `CAMPAIGN_MIN_GAP_MINUTES`)
- **Table Numbers**: Must be between 1-128 if provided
- **Import Count**: Defaults to 1 unless specified when uploading guests
- **Guest Count**: Optional (NULL until guest replies); when provided must be at least 1
- **Pagination**: Default page=1, page_size=20, max page_size=200
- **Authentication**: All endpoints require valid JWT token (except health checks)
### Error Responses

- **400**: Bad Request (invalid data, missing required fields)
- **401**: Unauthorized (invalid/missing JWT)
- **404**: Not Found (resource doesn't exist or no permission)
- **409**: Conflict (duplicate phone number within event)
- **422**: Validation Error (invalid data format)
- **500**: Internal Server Error
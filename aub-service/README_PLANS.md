# Plans API - MongoDB Backend

## Overview

Plans are now fully backend-driven from MongoDB. The frontend fetches plans via API endpoints, and all plan data is stored in MongoDB.

## Setup

### 1. MongoDB Configuration

Add MongoDB environment variables to your `.env` file:

```bash
MONGO_HOST=mongodb
MONGO_PORT=27017
MONGO_USER=admin
MONGO_PASSWORD=password
MONGO_DB_NAME=showup
```

### 2. Seed Initial Plans

Run the seed script to populate initial plans:

```bash
cd aub-service
python scripts/seed_plans.py
```

Or from the project root:

```bash
docker-compose exec aub-service python scripts/seed_plans.py
```

## API Endpoints

### GET /api/plans
Returns all active plans, sorted by price (ascending).

**Response:**
```json
[
  {
    "id": "basic",
    "title": "Basic",
    "subtitle": "בוא נתחיל",
    "price": "₪39",
    "description": "עד 50 אורחים",
    "features": ["...", "..."],
    "color": "#4CAF50",
    "isPopular": false,
    "campaigns": [
      {
        "enabled": true,
        "label": "תזכורת שבוע לפני",
        "offsetDays": 7,
        "time": "12:00"
      }
    ]
  }
]
```

### GET /api/plans/:id
Returns a single plan by ID.

### GET /api/plans/:id/campaigns
Returns campaigns for a specific plan, sorted by offsetDays (descending).

## MongoDB Schema

Plans are stored in the `plans` collection with the following structure:

```javascript
{
  _id: ObjectId,
  id: "basic" | "plus" | "pro",  // String ID for easy lookup
  title: string,
  subtitle: string,
  price: string,
  description: string,
  features: [string],
  color: string,
  is_popular: boolean,
  is_active: boolean,
  campaigns: [
    {
      enabled: boolean,
      label: string,
      offset_days: number,  // Can also be stored as offsetDays
      time: string
    }
  ],
  created_at: ISODate,
  updated_at: ISODate
}
```

## Frontend Usage

The frontend uses the `usePlans()` hook to fetch plans:

```typescript
import { usePlans, usePlanCampaigns } from '../hooks/usePlans';

const { plans, loading, error } = usePlans();
const { campaigns } = usePlanCampaigns(selectedPlanId);
```

## Migration Notes

- The static `plans.ts` file has been removed from the frontend
- All plan data now comes from MongoDB via API
- Campaign schedules are included in the plan response
- Plans can be edited directly in MongoDB without code changes

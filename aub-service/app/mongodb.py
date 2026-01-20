"""
MongoDB connection and utilities for aub-service
"""
import os
from pymongo import MongoClient
from pymongo.database import Database
from typing import Optional


def get_mongodb_config():
    """Get MongoDB configuration from environment variables"""
    return {
        "MONGO_HOST": os.getenv("MONGO_HOST", "localhost"),
        "MONGO_PORT": int(os.getenv("MONGO_PORT", 27017)),
        "MONGO_USER": os.getenv("MONGO_USER", ""),
        "MONGO_PASSWORD": os.getenv("MONGO_PASSWORD", ""),
        "MONGO_DB_NAME": os.getenv("MONGO_DB_NAME", "showup"),
    }


_client: Optional[MongoClient] = None
_db: Optional[Database] = None


def get_mongodb_client() -> MongoClient:
    """Get or create MongoDB client (singleton)"""
    global _client
    if _client is None:
        config = get_mongodb_config()
        if config["MONGO_USER"] and config["MONGO_PASSWORD"]:
            uri = f"mongodb://{config['MONGO_USER']}:{config['MONGO_PASSWORD']}@{config['MONGO_HOST']}:{config['MONGO_PORT']}/{config['MONGO_DB_NAME']}?authSource=admin"
        else:
            uri = f"mongodb://{config['MONGO_HOST']}:{config['MONGO_PORT']}/{config['MONGO_DB_NAME']}"
        _client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    return _client


def get_mongodb_db() -> Database:
    """Get MongoDB database instance"""
    global _db
    if _db is None:
        config = get_mongodb_config()
        client = get_mongodb_client()
        _db = client[config["MONGO_DB_NAME"]]
    return _db


def check_mongodb_connection() -> bool:
    """Check if MongoDB connection is healthy"""
    try:
        client = get_mongodb_client()
        client.admin.command('ping')
        return True
    except Exception:
        return False

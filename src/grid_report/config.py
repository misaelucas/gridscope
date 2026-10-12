"""Keep environment-specific values outside business logic."""
import os
from pathlib import Path

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://grid:grid@localhost:55432/grid")
RAW_DIR = Path(os.getenv("RAW_DIR", "data/raw"))
SOURCE_URL = "https://api.energidataservice.dk/dataset/CO2Emis"

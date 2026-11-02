"""Geomatrix v2 GIS Map Router"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db
from models import Project
from schemas import GeoFeatureCollection, GeoFeature

router = APIRouter(prefix="/api/map", tags=["map"])


STATE_COORDINATES = {
    "andhra pradesh": (15.9129, 79.7400),
    "telangana": (18.1124, 79.0193),
    "odisha": (20.9517, 85.0985),
    "bihar": (25.0961, 85.3131),
    "punjab": (31.1471, 75.3412),
    "delhi": (28.7041, 77.1025),
    "gujarat": (22.2587, 71.1924),
    "karnataka": (15.3173, 75.7139),
    "west bengal": (22.9868, 87.8550),
    "maharashtra": (19.7515, 75.7139),
    "chhattisgarh": (21.2787, 81.8661),
    "uttarakhand": (30.0668, 79.0193),
}
DEFAULT_COORDS = (20.5937, 78.9629)


@router.get("/geojson", response_model=GeoFeatureCollection)
def get_geojson(
    risk_level: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Returns GeoJSON FeatureCollection of real project coordinates from DB.
    Includes state centroid fallbacks for projects without explicit lat/lng in CSV.
    """
    q = db.query(Project)
    if risk_level:
        q = q.filter(Project.risk_level == risk_level)

    projects = q.all()

    features = []
    for idx, p in enumerate(projects):
        lat = p.latitude
        lng = p.longitude
        if not lat or not lng or lat == 0.0 or lng == 0.0:
            st = (p.state or "").strip().lower()
            base_lat, base_lng = STATE_COORDINATES.get(st, DEFAULT_COORDS)
            # Add small deterministic offset per project index so markers don't overlap exactly
            lat = base_lat + ((idx % 5) - 2) * 0.15
            lng = base_lng + ((idx // 5) % 5 - 2) * 0.15

        feat = GeoFeature(
            geometry={
                "type": "Point",
                "coordinates": [lng, lat]
            },
            properties={
                "id": p.id,
                "project_code": p.project_code,
                "name": p.name,
                "state": p.state,
                "district": p.district,
                "authority": p.authority,
                "project_type": p.project_type,
                "current_stage": p.current_stage,
                "status": p.status,
                "risk_score": p.risk_score,
                "risk_level": p.risk_level,
                "delay_probability": p.delay_probability,
                "predicted_delay_days": p.predicted_delay_days,
                "land_required": p.land_required,
                "affected_families": p.affected_families,
                "source_url": p.source_url,
            }
        )
        features.append(feat)

    return GeoFeatureCollection(features=features)


@router.get("/summary")
def map_summary(db: Session = Depends(get_db)):
    total = db.query(Project).count()
    with_coords = db.query(Project).filter(
        Project.latitude.isnot(None),
        Project.longitude.isnot(None),
        Project.latitude != 0.0,
        Project.longitude != 0.0,
    ).count()
    return {
        "total_projects": total,
        "projects_with_coordinates": with_coords,
        "projects_without_coordinates": total - with_coords,
    }


@router.get("/projects")
def map_projects(db: Session = Depends(get_db)):
    return {"data": get_geojson(None, db).model_dump()["features"]}
